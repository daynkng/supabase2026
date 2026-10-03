import Stripe from "stripe";
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
export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new AppError(
      "A Stripe test secret key is required. Live keys are not accepted.",
      503,
    );
  return new Stripe(key, { timeout: 20000, maxNetworkRetries: 1 });
}
export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}
export async function requestPayment(
  project: string,
  amount: number,
  category: string,
  description: string,
  requestId: string,
) {
  stripe();
  z.number().int().positive().max(10000000).parse(amount);
  return transaction(async (c) => {
    const p = await lockScope(c, project);
    const all = await rows("transactions", project, c);
    const previous = all.find((t) => t.data.request_id === requestId);
    if (previous) {
      if (
        previous.data.provider === "link" ||
        previous.data.amount_cents !== amount ||
        previous.data.category !== category ||
        previous.data.description !== description
      )
        throw new AppError(
          "Payment request ID reused with different inputs",
          409,
        );
      return {
        transaction: previous,
        review_url: `${appUrl()}/?project=${project}&tab=budget&payment=${previous.id}`,
      };
    }
    if (p.data.budget_total_cents === undefined)
      throw new AppError("Project has no budget");
    for (const t of all)
      if (
        t.data.status === "requested" &&
        new Date(t.data.expires_at).getTime() < Date.now()
      )
        await update("transactions", t.id, { status: "expired" }, c);
    const current = await rows("transactions", project, c);
    if (amount > budget(p, current).available_cents)
      throw new AppError("Payment exceeds available budget", 409);
    const t = await insert(
      "transactions",
      project,
      {
        amount_cents: amount,
        currency: "USD",
        category,
        description,
        request_id: requestId,
        status: "requested",
        requires_approval: amount > (p.data.approval_threshold_cents ?? 20000),
        expires_at: new Date(Date.now() + 1800000).toISOString(),
      },
      c,
    );
    await update("projects", project, {}, c);
    await activity(
      project,
      "Agent",
      `Requested ${description} test payment`,
      { transaction_id: t.id },
      c,
    );
    return {
      transaction: t,
      review_url: `${appUrl()}/?project=${project}&tab=budget&payment=${t.id}`,
    };
  });
}
export async function checkout(id: string) {
  return transaction(async (c) => {
    const existing = await get("transactions", id, c);
    await lockScope(c, existing.project_id);
    const t = await get("transactions", id, c);
    if (t.data.provider === "link")
      throw new AppError("Use the Link wallet flow for this transaction", 409);
    if (t.data.status === "checkout" && t.data.checkout_url)
      return { url: t.data.checkout_url };
    if (
      t.data.status !== "requested" ||
      new Date(t.data.expires_at).getTime() < Date.now()
    )
      throw new AppError("Payment request is no longer available", 409);
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: t.data.amount_cents,
              product_data: { name: `[DEMO] ${t.data.description}` },
            },
            quantity: 1,
          },
        ],
        client_reference_id: id,
        metadata: { transaction_id: id, project_id: t.project_id! },
        success_url: `${appUrl()}/?project=${t.project_id}&tab=budget&payment=${id}&checkout=returned`,
        cancel_url: `${appUrl()}/?project=${t.project_id}&tab=budget`,
        // Use Stripe's default expiry so retries send identical parameters.
        // A changing timestamp conflicts with the stable idempotency key.
      },
      { idempotencyKey: `checkout:${id}` },
    );
    await update(
      "transactions",
      id,
      {
        status: "checkout",
        stripe_session_id: session.id,
        checkout_url: session.url,
        approved_at: new Date().toISOString(),
      },
      c,
    );
    await activity(
      t.project_id,
      "Human",
      `Approved ${t.data.description} for Stripe test Checkout`,
      { transaction_id: id },
      c,
    );
    return { url: session.url };
  });
}
export async function processStripeEvent(event: Stripe.Event) {
  if (event.livemode)
    throw new AppError("Live payment events are not accepted");
  const supported = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ];
  if (!supported.includes(event.type)) return { ignored: true };
  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.transaction_id;
  if (!id) throw new AppError("Missing transaction ID");
  return transaction(async (c) => {
    const initial = await get("transactions", id, c);
    await lockScope(c, initial.project_id);
    if (
      (await rows("processed_stripe_events", undefined, c)).some(
        (r) => r.data.event_id === event.id,
      )
    )
      return { duplicate: true };
    const t = await get("transactions", id, c);
    if (t.data.provider === "link")
      throw new AppError("Use the Link wallet flow for this transaction", 409);
    if (
      session.metadata?.project_id !== t.project_id ||
      session.currency !== "usd" ||
      session.amount_total !== t.data.amount_cents
    )
      throw new AppError("Payment amount or scope mismatch");
    if (t.data.stripe_session_id && t.data.stripe_session_id !== session.id)
      throw new AppError("Checkout session mismatch");
    let next = t.data.status;
    if (event.type === "checkout.session.expired") next = "expired";
    else if (event.type === "checkout.session.async_payment_failed")
      next = "failed";
    else if (session.payment_status === "paid") next = "succeeded";
    next = transitionPayment(t.data.status, next);
    await update(
      "transactions",
      id,
      {
        status: next,
        stripe_session_id: session.id,
        ...(next === "succeeded" && t.data.status !== "succeeded"
          ? {
              stripe_payment_id:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id,
              paid_at: new Date().toISOString(),
            }
          : {}),
      },
      c,
    );
    if (next === "succeeded" && t.data.status !== "succeeded") {
      const task = (await rows("tasks", t.project_id, c)).find(
        (r) => r.data.title.toLowerCase() === t.data.category.toLowerCase(),
      );
      if (task)
        await update(
          "tasks",
          task.id,
          {
            status: "completed",
            completed_by: "Stripe test",
            completed_at: new Date().toISOString(),
            description: "Simulated booking: verified Stripe test payment.",
          },
          c,
        );
      await activity(
        t.project_id,
        "Stripe test",
        `Confirmed ${t.data.description} test payment`,
        { transaction_id: id },
        c,
      );
    }
    await insert(
      "processed_stripe_events",
      t.project_id,
      { event_id: event.id },
      c,
    );
    await update("projects", t.project_id!, {}, c);
    return { ok: true };
  });
}
