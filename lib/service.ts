import { z } from "zod";
import { OWNER, AppError, active } from "./domain";
import {
  configured,
  rows,
  get,
  insert,
  update,
  activity,
  transaction,
  lockScope,
} from "./db";
import { seed } from "./seed";
import { writeUpdate, ingestOutput, indexPending } from "./state";
import { contextPack, searchArtifacts } from "./retrieval";
import { beginUpload, saveText, processArtifact, canonical } from "./artifacts";
import { signedDownload } from "./storage";
import { requestPayment, checkout } from "./payments";
import { commitWork } from "./commit-work";
const uuid = z.string().uuid();
const str = z.string().min(1).max(1000);
export async function snapshot() {
  if (!configured())
    return { ...seed(), preview: true, providers: providerStatus() };
  const names = [
    "users",
    "projects",
    "context_items",
    "sources",
    "tasks",
    "artifacts",
    "activities",
    "ingestion_runs",
    "context_retrievals",
    "transactions",
  ] as const;
  const results = await Promise.all(names.map((t) => rows(t)));
  return {
    ...Object.fromEntries(names.map((t, i) => [t, results[i]])),
    preview: false,
    providers: providerStatus(),
  };
}
export function providerStatus() {
  return {
    database: configured(),
    storage: !!(
      process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    ),
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    stripe: !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"),
    webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
  };
}
export async function execute(
  action: string,
  input: any,
  human = false,
  actor = "Agent",
): Promise<any> {
  switch (action) {
    case "snapshot":
      return snapshot();
    case "list_projects":
      return rows("projects");
    case "get_project_state": {
      const id = uuid.parse(input.project_id);
      await get("projects", id);
      const data = await snapshot();
      return Object.fromEntries(
        Object.entries(data)
          .filter(
            ([k]) => !["sources", "users", "providers", "preview"].includes(k),
          )
          .map(([k, v]) => [
            k,
            Array.isArray(v)
              ? v.filter((r: any) =>
                  k === "projects" ? r.id === id : r.project_id === id,
                )
              : v,
          ]),
      );
    }
    case "get_context":
      return contextPack(
        z.string().min(1).max(10000).parse(input.task),
        input.project_id ? uuid.parse(input.project_id) : undefined,
        actor,
      );
    case "write_update": {
      const result = await writeUpdate(
        {
          ...input,
          project_id: input.project_id ? uuid.parse(input.project_id) : null,
          source_agent: human ? "Human" : actor,
        },
        human,
      );
      return {
        ...result,
        indexing: await indexPending(input.project_id ?? null),
      };
    }
    case "ingest_output":
      return ingestOutput(
        uuid.parse(input.project_id),
        input.text,
        str.parse(input.source_agent ?? actor),
        str.parse(input.request_id),
      );
    case "commit_work":
      return commitWork(input, actor);
    case "search_artifacts":
      return searchArtifacts(
        uuid.parse(input.project_id),
        str.parse(input.query),
      );
    case "save_artifact": {
      const id = uuid.parse(input.project_id);
      if (input.artifact.text !== undefined)
        return saveText(
          id,
          str.parse(input.artifact.name),
          z.string().parse(input.artifact.text),
          actor,
          input.artifact.parent_artifact_id,
          input.artifact.replaces_artifact_id,
        );
      const a = await get(
        "artifacts",
        uuid.parse(input.artifact.upload_reference),
      );
      if (a.project_id !== id) throw new AppError("Artifact scope mismatch");
      return processArtifact(a.id);
    }
    case "request_payment":
      return requestPayment(
        uuid.parse(input.project_id),
        input.amount_cents,
        str.parse(input.category),
        str.parse(input.description),
        str.parse(input.request_id ?? crypto.randomUUID()),
      );
  }
  if (!human) throw new AppError("Human UI action required", 403);
  switch (action) {
    case "resolve_review": {
      const record = await get("ingestion_runs", uuid.parse(input.id));
      const index = z.number().int().nonnegative().parse(input.index);
      const resolution = z.enum(["apply", "dismiss"]).parse(input.resolution);
      const proposed = record.data.result?.review?.[index];
      if (!proposed) throw new AppError("Review proposal not found", 404);
      if (record.data.review_resolutions?.[index])
        return { already_resolved: true };
      if (resolution === "apply") {
        const { conflict_reason, ...op } = proposed;
        if (
          input.replaces_id &&
          ["add_context", "supersede_context"].includes(op.op)
        ) {
          op.op = "supersede_context";
          op.id = uuid.parse(input.replaces_id);
        }
        await writeUpdate(
          {
            project_id: record.project_id,
            state_delta: [op],
            request_id: `review:${record.id}:${index}`,
            expected_revision: input.expected_revision,
            source_agent: "Human review",
          },
          true,
        );
      }
      return transaction(async (c) => {
        await lockScope(c, record.project_id);
        const latest = await get("ingestion_runs", record.id, c);
        const resolutions = {
          ...latest.data.review_resolutions,
          [index]: resolution,
        };
        await update(
          "ingestion_runs",
          record.id,
          {
            review_resolutions: resolutions,
            stage:
              Object.keys(resolutions).length ===
              latest.data.result.review.length
                ? "complete"
                : "needs_review",
          },
          c,
        );
        await activity(
          record.project_id,
          "Human",
          `${resolution === "apply" ? "Applied" : "Dismissed"} a reviewed state proposal`,
          {},
          c,
        );
        return { ok: true };
      });
    }
    case "create_project": {
      const p = z
        .object({
          name: str,
          goal: z.string().min(1).max(3000),
          type: z.enum(["work", "personal"]),
          budget_total_cents: z.number().int().positive().optional(),
          approval_threshold_cents: z.number().int().nonnegative().optional(),
        })
        .parse(input);
      const rules = (await rows("context_items", null)).filter(
        (r) =>
          active(r) &&
          r.data.kind === "permission" &&
          typeof r.data.approval_threshold_cents === "number",
      );
      const threshold = Math.min(
        p.approval_threshold_cents ?? 20000,
        ...rules.map((r) => r.data.approval_threshold_cents),
      );
      const row = await insert("projects", null, {
        ...p,
        ...(p.budget_total_cents !== undefined
          ? { approval_threshold_cents: threshold }
          : {}),
        status: "active",
      });
      await activity(row.id, "Human", "Created project");
      return row;
    }
    case "begin_upload":
      return beginUpload(
        uuid.parse(input.project_id),
        str.parse(input.name),
        str.parse(input.mime),
        input.size,
        input.parent_artifact_id,
      );
    case "process_artifact":
      return processArtifact(uuid.parse(input.id));
    case "canonical":
      return canonical(uuid.parse(input.id));
    case "archive_artifact": {
      const a = await get("artifacts", uuid.parse(input.id));
      return transaction(async (c) => {
        await lockScope(c, a.project_id);
        await update(
          "artifacts",
          a.id,
          { status: "archived", is_canonical: false },
          c,
        );
        await update("projects", a.project_id!, {}, c);
        await activity(
          a.project_id,
          "Human",
          `Archived ${a.data.name}`,
          { artifact_id: a.id },
          c,
        );
        return { ok: true };
      });
    }
    case "artifact_detail": {
      const a = await get("artifacts", uuid.parse(input.id));
      return {
        artifact: a,
        chunks: (await rows("artifact_chunks", a.project_id)).filter(
          (c) => c.data.artifact_id === a.id,
        ),
        download_url: a.data.storage_path
          ? await signedDownload(a.data.storage_path)
          : null,
      };
    }
    case "checkout":
      return checkout(uuid.parse(input.id));
    case "retry_indexing": {
      const id = input.project_id ? uuid.parse(input.project_id) : null;
      return indexPending(id);
    }
    case "set_permission": {
      const amount = z
        .number()
        .int()
        .nonnegative()
        .parse(input.approval_threshold_cents);
      return transaction(async (c) => {
        await lockScope(c, null);
        const old = (await rows("context_items", null, c)).filter(
          (r) => active(r) && r.data.kind === "permission",
        );
        for (const r of old)
          await update("context_items", r.id, { status: "superseded" }, c);
        const source = await insert(
          "sources",
          null,
          {
            source_type: "human",
            source_agent: "Human",
            excerpt: `Approval threshold: ${amount} cents`,
          },
          c,
        );
        await insert(
          "context_items",
          null,
          {
            scope: "personal",
            kind: "permission",
            status: "active",
            content: `Purchases above $${(amount / 100).toFixed(2)} require human approval`,
            approval_threshold_cents: amount,
            source_id: source.id,
            source_agent: "Human",
            confidence: 1,
          },
          c,
        );
        for (const p of await rows("projects", undefined, c))
          if (p.data.budget_total_cents !== undefined) {
            await lockScope(c, p.id);
            await update(
              "projects",
              p.id,
              {
                approval_threshold_cents: Math.min(
                  p.data.approval_threshold_cents ?? amount,
                  amount,
                ),
              },
              c,
            );
          }
        await update("users", OWNER, {}, c);
        await activity(null, "Human", "Updated spending approval rule", {}, c);
        return { ok: true };
      });
    }
    default:
      throw new AppError("Unknown action", 404);
  }
}
