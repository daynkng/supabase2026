import Link, { type SpendRequest } from "@stripe/link-sdk";
import { z } from "zod";
import { AppError, budget, transitionPayment } from "./domain";
import {
  transaction,
  lockScope,
  rows,
  get,
  insert,
  update,
  activity,
} from "./db";
import { getAccessToken } from "./wallet-tokens";

export const walletRequestSchema = z
  .object({
    project_id: z.string().uuid(),
    request_id: z.string().min(1).max(100),
    amount_cents: z.number().int().positive().max(10000000),
    category: z.string().min(1).max(100),
    description: z.string().min(100).max(2000),
    merchant_name: z.string().min(1).max(200),
    merchant_url: z
      .string()
      .url()
      .refine(
        (s) => new URL(s).protocol === "https:",
        "Merchant URL must use HTTPS",
      ),
  })
  .strict();
export type WalletRequest = z.infer<typeof walletRequestSchema>;
export async function walletClient() {
  return new Link({
    accessToken: await getAccessToken(),
    fetch: (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }),
  });
}
function safeLinkUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "link.com" ||
        url.hostname.endsWith(".link.com") ||
        url.hostname === "stripe.com" ||
        url.hostname.endsWith(".stripe.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export function publicWalletResult(remote: SpendRequest) {
  const next = remote.status_details?.requires_action?.next_action;
  return {
    status: remote.status,
    approval_url: safeLinkUrl(remote.approval_url),
    next_action: next
      ? {
          resolution: next.resolution,
          message: next.display_message,
          url: safeLinkUrl(next.action_url),
        }
      : null,
  };
}
export function walletLedgerStatus(remote: string) {
  switch (remote) {
    case "succeeded":
      return "succeeded";
    case "approved":
      return "wallet_approved";
    case "submitted":
      return "wallet_submitted";
    case "failed":
    case "denied":
    case "canceled":
      return "failed";
    case "expired":
      return "expired";
    default:
      return "wallet_pending";
  }
}
export async function applyWalletResult(id: string, remote: SpendRequest) {
  return transaction(async (c) => {
    const initial = await get("transactions", id, c);
    await lockScope(c, initial.project_id);
    const t = await get("transactions", id, c);
    if (t.data.provider !== "link" || !t.data.test_mode)
      throw new AppError("Not a Link test transaction");
    if (remote.amount !== t.data.amount_cents || remote.currency !== "usd")
      throw new AppError("Link amount or currency mismatch", 409);
    if (
      t.data.link_spend_request_id &&
      t.data.link_spend_request_id !== remote.id
    )
      throw new AppError("Link request mismatch", 409);
    if (
      !t.data.link_spend_request_id &&
      (remote.metadata?.transaction_id !== t.id ||
        remote.metadata?.project_id !== t.project_id)
    )
      throw new AppError("Link scope mismatch", 409);
    const next = transitionPayment(
      t.data.status,
      walletLedgerStatus(remote.status),
    );
    const changed =
      next !== t.data.status || remote.status !== t.data.link_status;
    const updated = await update(
      "transactions",
      id,
      {
        status: next,
        link_spend_request_id: remote.id,
        link_status:
          t.data.status === "succeeded" ? "succeeded" : remote.status,
        last_checked_at: new Date().toISOString(),
        sync_error: null,
        ...(next === "succeeded" && t.data.status !== "succeeded"
          ? { paid_at: new Date().toISOString() }
          : {}),
      },
      c,
    );
    if (changed && t.data.status !== "succeeded") {
      await update("projects", t.project_id!, {}, c);
      await activity(
        t.project_id,
        "Link test",
        `Wallet request ${remote.status}`,
        { transaction_id: id },
        c,
      );
      if (next === "succeeded") {
        const task = (await rows("tasks", t.project_id, c)).find(
          (r) => r.data.title.toLowerCase() === t.data.category.toLowerCase(),
        );
        if (task)
          await update(
            "tasks",
            task.id,
            {
              status: "completed",
              completed_by: "Link test",
              completed_at: new Date().toISOString(),
              description: "Simulated purchase: Link test payment confirmed.",
            },
            c,
          );
      }
    }
    return { transaction: updated, ...publicWalletResult(remote) };
  });
}
export async function requestWalletPayment(input: unknown) {
  const data = walletRequestSchema.parse(input);
  const client = await walletClient();
  const t = await transaction(async (c) => {
    const p = await lockScope(c, data.project_id);
    const all = await rows("transactions", data.project_id, c);
    const prior = all.find((t) => t.data.request_id === data.request_id);
    if (prior) {
      if (
        prior.data.provider !== "link" ||
        Object.entries(data).some(
          ([k, v]) => k !== "project_id" && prior.data[k] !== v,
        )
      )
        throw new AppError(
          "Payment request ID reused with different inputs",
          409,
        );
      return prior;
    }
    if (p.data.budget_total_cents === undefined)
      throw new AppError("Project has no budget");
    if (data.amount_cents > budget(p, all).available_cents)
      throw new AppError("Payment exceeds available budget", 409);
    const { project_id, ...fields } = data;
    const t = await insert(
      "transactions",
      project_id,
      {
        ...fields,
        currency: "USD",
        provider: "link",
        test_mode: true,
        status: "wallet_pending",
        link_status: "not_created",
        requires_approval: true,
      },
      c,
    );
    await update("projects", project_id, {}, c);
    await activity(
      project_id,
      "Agent",
      "Reserved budget for Link test purchase",
      { transaction_id: t.id },
      c,
    );
    return t;
  });
  return submitWalletRequest(t.id, client);
}
async function submitWalletRequest(id: string, client: Link) {
  const t = await get("transactions", id);
  if (t.data.provider !== "link" || !t.data.test_mode)
    throw new AppError("Not a Link test transaction");
  try {
    let remote = t.data.link_spend_request_id
      ? await client.spendRequests.retrieve(t.data.link_spend_request_id)
      : await client.spendRequests.create({
          idempotency_key: `wallet:${t.id}`,
          credential_type: "card",
          test: true,
          request_approval: true,
          amount: t.data.amount_cents,
          currency: "usd",
          merchant_name: t.data.merchant_name,
          merchant_url: t.data.merchant_url,
          context: t.data.description,
          metadata: { transaction_id: t.id, project_id: t.project_id! },
        });
    if (!remote) throw new AppError("Link spend request was not found", 502);
    if (remote.status === "created") {
      const approval = await client.spendRequests.requestApproval(remote.id);
      remote = { ...remote, approval_url: approval.approval_url };
    }
    return await applyWalletResult(id, remote);
  } catch {
    await transaction(async (c) => {
      await lockScope(c, t.project_id);
      await update(
        "transactions",
        id,
        {
          sync_error:
            "Link request could not be synchronized. Retry to recover the same purchase; budget stays reserved.",
        },
        c,
      );
    });
    throw new AppError(
      "Link request could not be synchronized. Retry this transaction; its budget remains reserved.",
      502,
    );
  }
}
export async function refreshWalletPayment(id: string) {
  return submitWalletRequest(z.string().uuid().parse(id), await walletClient());
}
export async function cancelWalletPayment(id: string) {
  // First recover an ambiguous create with the same idempotency key, then cancel it remotely.
  await refreshWalletPayment(id);
  const t = await get("transactions", id);
  if (t.data.status === "succeeded")
    throw new AppError("Completed payments cannot be canceled", 409);
  const client = await walletClient();
  return applyWalletResult(
    id,
    await client.spendRequests.cancel(t.data.link_spend_request_id),
  );
}
export async function walletCredential(id: string) {
  const t = await get("transactions", z.string().uuid().parse(id));
  if (
    t.data.provider !== "link" ||
    !t.data.test_mode ||
    ["succeeded", "failed", "expired"].includes(t.data.status) ||
    !t.data.link_spend_request_id
  )
    throw new AppError("No Link test credential is available", 409);
  const remote = await (
    await walletClient()
  ).spendRequests.retrieve(t.data.link_spend_request_id, { include: ["card"] });
  if (!remote) throw new AppError("Link request not found", 404);
  await applyWalletResult(id, remote);
  if (remote.status !== "approved" || !remote.card)
    throw new AppError(
      "Link approval and an available credential are required",
      409,
    );
  return {
    transaction_id: id,
    test_mode: true,
    merchant_url: t.data.merchant_url,
    amount_cents: t.data.amount_cents,
    card: remote.card,
  };
}
