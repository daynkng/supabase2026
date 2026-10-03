import { z } from "zod";
import { createHash } from "node:crypto";
import {
  OWNER,
  AppError,
  deltaSchema,
  validateOperation,
  normalize,
  active,
} from "./domain";
import {
  transaction,
  lockScope,
  rows,
  get,
  insert,
  update,
  activity,
  db,
} from "./db";
import { claude, embed } from "./models";
export async function writeUpdate(
  input: {
    project_id?: string | null;
    state_delta: unknown;
    request_id: string;
    expected_revision: number;
    source_agent?: string;
    excerpt?: string;
    source_id?: string;
  },
  human = false,
) {
  const ops = deltaSchema.parse(input.state_delta);
  const project = input.project_id ?? null;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ project, ops }))
    .digest("hex");
  z.string().min(1).max(200).parse(input.request_id);
  if (!Number.isInteger(input.expected_revision))
    throw new AppError("expected_revision is required");
  const result = await transaction(async (c) => {
    const scope = await lockScope(c, project);
    const previous = (await rows("ingestion_runs", undefined, c)).find(
      (r) => r.data.request_id === input.request_id,
    );
    if (previous) {
      if (previous.project_id !== project)
        throw new AppError("Request ID belongs to another scope", 409);
      if (previous.data.fingerprint !== fingerprint)
        throw new AppError("Request ID reused with different changes", 409);
      return previous.data.result;
    }
    if (scope.revision !== input.expected_revision)
      throw new AppError(
        `Revision conflict. Current revision: ${scope.revision}`,
        409,
      );
    const source = input.source_id
      ? await get("sources", input.source_id, c)
      : await insert(
          "sources",
          project,
          {
            source_type: human ? "human" : "agent_output",
            source_agent: input.source_agent ?? "Agent",
            excerpt: input.excerpt ?? JSON.stringify(ops),
          },
          c,
        );
    if (source.project_id !== project)
      throw new AppError("Source scope mismatch");
    const accepted: any[] = [];
    const review: any[] = [];
    for (const op of ops) {
      validateOperation(op, human);
      if (op.conflict_reason) {
        review.push(op);
        continue;
      }
      if (op.op === "add_context" || op.op === "supersede_context") {
        const old =
          op.op === "supersede_context"
            ? await get("context_items", op.id!, c)
            : null;
        if (old && (old.project_id !== project || !active(old)))
          throw new AppError(
            "Replacement target is not active in this scope",
            409,
          );
        if (old?.data.kind === "permission" && !human)
          throw new AppError("Only a human can change permissions", 403);
        const existing = await rows("context_items", project, c);
        const duplicate = existing.find(
          (r) =>
            active(r) &&
            r.data.kind === op.kind &&
            normalize(r.data.content) === normalize(op.content!),
        );
        if (duplicate) {
          if (old && old.id !== duplicate.id)
            await update(
              "context_items",
              old.id,
              { status: "superseded", replaced_by_id: duplicate.id },
              c,
            );
          accepted.push({
            operation:
              old && old.id !== duplicate.id
                ? "supersede_context"
                : "ignored_duplicate",
            id: duplicate.id,
            content: op.content,
          });
          continue;
        }
        if (op.op === "supersede_context") {
          await update("context_items", old!.id, { status: "superseded" }, c);
        }
        const r = await insert(
          "context_items",
          project,
          {
            scope: project ? "project" : "personal",
            kind: op.kind,
            content: op.content,
            status: "active",
            confidence: op.confidence,
            source_id: source.id,
            source_agent: input.source_agent ?? "Agent",
            supersedes_id: op.id ?? null,
            indexing_status: "pending",
          },
          c,
        );
        accepted.push({ operation: op.op, id: r.id, content: op.content });
      } else if (op.op === "archive_context" || op.op === "resolve_question") {
        const old = await get("context_items", op.id!, c);
        if (old.project_id !== project) throw new AppError("Scope mismatch");
        if (old.data.kind === "permission" && !human)
          throw new AppError("Only a human can change permissions", 403);
        if (op.op === "resolve_question" && old.data.kind !== "open_question")
          throw new AppError("Not an open question");
        await update(
          "context_items",
          old.id,
          { status: "archived", resolved: op.op === "resolve_question" },
          c,
        );
        accepted.push({ operation: op.op, id: old.id });
      } else {
        if (!project) throw new AppError("Tasks require a project");
        if (op.op === "create_task") {
          const r = await insert(
            "tasks",
            project,
            {
              title: op.title,
              description: op.description ?? "",
              status: op.status ?? "pending",
              source_id: source.id,
              created_by: input.source_agent ?? "Human",
            },
            c,
          );
          accepted.push({ operation: op.op, id: r.id });
        } else {
          const old = await get("tasks", op.id!, c);
          if (old.project_id !== project)
            throw new AppError("Task scope mismatch");
          if (op.status === "completed" && old.data.payment_category) {
            const paid = (await rows("transactions", project, c)).some(
              (t) =>
                t.data.status === "succeeded" &&
                t.data.category.toLowerCase() ===
                  old.data.payment_category.toLowerCase(),
            );
            if (!paid)
              throw new AppError(
                "Booking tasks require a verified successful test payment",
                409,
              );
          }
          await update(
            "tasks",
            old.id,
            {
              ...(op.title ? { title: op.title } : {}),
              ...(op.description !== undefined
                ? { description: op.description }
                : {}),
              ...(op.status
                ? {
                    status: op.status,
                    completed_at:
                      op.status === "completed"
                        ? new Date().toISOString()
                        : null,
                    completed_by:
                      op.status === "completed" ? input.source_agent : null,
                  }
                : {}),
              source_id: source.id,
            },
            c,
          );
          accepted.push({ operation: op.op, id: old.id });
        }
      }
    }
    await update(project ? "projects" : "users", project ?? OWNER, {}, c);
    const result = { accepted, review, revision: scope.revision + 1 };
    await insert(
      "ingestion_runs",
      project,
      {
        request_id: input.request_id,
        fingerprint,
        stage: review.length ? "needs_review" : "complete",
        result,
        source_id: source.id,
      },
      c,
    );
    await activity(
      project,
      input.source_agent ?? "Human",
      `${accepted.filter((x) => x.operation !== "ignored_duplicate").length} state changes accepted${review.length ? `; ${review.length} need review` : ""}`,
      { source_id: source.id, changes: accepted },
      c,
    );
    return result;
  });
  return result;
}
export async function indexPending(project: string | null) {
  const candidates = (await rows("context_items", project)).filter(
    (r) => active(r) && r.data.indexing_status !== "ready",
  );
  let failed = 0;
  for (const r of candidates) {
    try {
      const v = await embed(r.data.content);
      await db().query(
        "UPDATE context_items SET embedding=$1::vector,data=data || $2::jsonb WHERE id=$3 AND user_id=$4",
        [
          JSON.stringify(v),
          JSON.stringify({ indexing_status: "ready" }),
          r.id,
          OWNER,
        ],
      );
    } catch {
      failed++;
    }
  }
  return { indexed: candidates.length - failed, pending: failed };
}
export async function ingestOutput(
  project: string,
  text: string,
  agent: string,
  requestId: string,
  sourceId?: string,
) {
  z.string().min(1).max(60000).parse(text);
  const old = (await rows("ingestion_runs", project)).find(
    (r) => r.data.request_id === requestId,
  );
  if (old?.data.result) return old.data.result;
  const scope = await get("projects", project);
  const attempt = await insert("ingestion_runs", project, {
    stage: "extracting",
    attempt_request_id: requestId,
  });
  try {
    const delta = await extractOutputOperations(project, text);
    const applied = await writeUpdate({
      project_id: project,
      state_delta: delta,
      request_id: requestId,
      expected_revision: scope.revision,
      source_agent: agent,
      excerpt: text,
      source_id: sourceId,
    });
    const indexing = await indexPending(project);
    await update("ingestion_runs", attempt.id, {
      stage: "complete",
      result: applied,
    });
    return { ...applied, indexing };
  } catch (e) {
    await update("ingestion_runs", attempt.id, {
      stage: "failed",
      error: e instanceof Error ? e.message : "Unknown error",
    });
    await activity(project, agent, "Output ingestion failed", {
      action_type: "error",
      error: e instanceof Error ? e.message : "Unknown error",
    });
    throw e;
  }
}

export async function extractOutputOperations(project: string, text: string) {
  z.string().min(1).max(60000).parse(text);
  const [context, tasks] = await Promise.all([
    rows("context_items", project),
    rows("tasks", project),
  ]);
  const result = await claude(
    "Extract durable state changes. Return {operations:[]}. Each operation: op (add_context, supersede_context, archive_context, create_task, update_task, resolve_question), optional id, kind, content, title, description, status, confidence. Only explicit final findings, decisions, questions, and completed work supported by the output. Do not invent completed work. Never add permissions or financial changes. Explicit replacement requires an existing ID. Ambiguous contradictions use conflict_reason on the proposed operation. Ignore greetings, acknowledgements, brainstorming, speculation, reasoning traces, abandoned drafts, and repeated text.",
    { output: text, context: context.filter(active), tasks },
  );
  return deltaSchema.parse(result.operations);
}
