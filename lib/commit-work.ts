import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "./domain";
import {
  activity,
  get,
  insert,
  lockScope,
  rows,
  transaction,
  update,
} from "./db";
import { saveText } from "./artifacts";
import { extractOutputOperations, indexPending, writeUpdate } from "./state";

const deliverableSchema = z
  .object({
    name: z.string().min(1).max(1000),
    text: z.string().min(1).max(200000),
    parent_artifact_id: z.string().uuid().optional(),
    replaces_artifact_id: z.string().uuid().optional(),
  })
  .strict();

export const commitWorkSchema = z
  .object({
    project_id: z.string().uuid(),
    request_id: z.string().min(1).max(160),
    output_text: z.string().min(1).max(60000),
    deliverable: deliverableSchema.optional(),
  })
  .strict();

export type CommitWorkInput = z.infer<typeof commitWorkSchema>;

type CommitWorkDependencies = {
  saveDeliverable: typeof saveText;
  extractOperations: typeof extractOutputOperations;
  index: typeof indexPending;
};

const defaultDependencies: CommitWorkDependencies = {
  saveDeliverable: saveText,
  extractOperations: extractOutputOperations,
  index: indexPending,
};

export async function commitWork(
  input: unknown,
  agent: string,
  dependencies: CommitWorkDependencies = defaultDependencies,
) {
  const value = commitWorkSchema.parse(input);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        project_id: value.project_id,
        output_text: value.output_text,
        deliverable: value.deliverable ?? null,
      }),
    )
    .digest("hex");

  const reserved = await transaction(async (client) => {
    await lockScope(client, value.project_id);
    const previous = (await rows("ingestion_runs", undefined, client)).find(
      (row) => row.data.request_id === value.request_id,
    );
    if (previous) {
      if (
        previous.project_id !== value.project_id ||
        previous.data.fingerprint !== fingerprint ||
        previous.data.run_type !== "commit_work"
      )
        throw new AppError("Request ID reused with different work", 409);
      if (previous.data.result)
        return { run: previous, result: previous.data.result };
      if (
        !["failed", "artifact_saved_needs_retry"].includes(
          previous.data.stage,
        ) &&
        Date.now() - new Date(previous.updated_at).getTime() < 5 * 60 * 1000
      )
        throw new AppError("This write-back is already processing", 409);
      await update(
        "ingestion_runs",
        previous.id,
        { stage: "saving", error: null },
        client,
      );
      return { run: previous };
    }
    const source = await insert(
      "sources",
      value.project_id,
      {
        source_type: "agent_output",
        source_agent: agent,
        excerpt: value.output_text,
        request_id: value.request_id,
      },
      client,
    );
    const run = await insert(
      "ingestion_runs",
      value.project_id,
      {
        run_type: "commit_work",
        request_id: value.request_id,
        fingerprint,
        source_id: source.id,
        source_agent: agent,
        output_text: value.output_text,
        stage: "saving",
      },
      client,
    );
    return { run };
  });
  if (reserved.result) return reserved.result;

  let artifact = reserved.run.data.artifact_id
    ? await get("artifacts", reserved.run.data.artifact_id)
    : null;
  try {
    if (value.deliverable && !artifact) {
      artifact = await dependencies.saveDeliverable(
        value.project_id,
        value.deliverable.name,
        value.deliverable.text,
        agent,
        value.deliverable.parent_artifact_id,
        value.deliverable.replaces_artifact_id,
        { requestId: value.request_id, process: false },
      );
      await update("ingestion_runs", reserved.run.id, {
        artifact_id: artifact.id,
        stage: "extracting",
      });
    } else {
      await update("ingestion_runs", reserved.run.id, { stage: "extracting" });
    }

    const operations = await dependencies.extractOperations(
      value.project_id,
      value.output_text,
    );
    let stateResult: {
      accepted: any[];
      review: any[];
      revision: number;
    };
    let indexing = { indexed: 0, pending: 0 };
    if (operations.length) {
      const scope = await get("projects", value.project_id);
      stateResult = await writeUpdate({
        project_id: value.project_id,
        state_delta: operations,
        request_id: `commit-state:${value.request_id}`,
        expected_revision: scope.revision,
        source_agent: agent,
        excerpt: value.output_text,
        source_id: reserved.run.data.source_id,
      });
      indexing = await dependencies.index(value.project_id);
    } else {
      stateResult = {
        accepted: [],
        review: [],
        revision: (await get("projects", value.project_id)).revision,
      };
    }
    const ignored = operations.length === 0 && !artifact;
    const result = {
      artifact,
      ...stateResult,
      indexing,
      write_back_id: reserved.run.id,
      ...(ignored ? { ignored: true } : {}),
    };
    if (ignored) {
      await transaction(async (client) => {
        await update(
          "ingestion_runs",
          reserved.run.id,
          {
            stage: "complete",
            result,
            artifact_id: null,
            output_text: null,
            source_id: null,
          },
          client,
        );
        await client.query("DELETE FROM sources WHERE id=$1 AND user_id=$2", [
          reserved.run.data.source_id,
          reserved.run.user_id,
        ]);
      });
      return result;
    }
    await update("ingestion_runs", reserved.run.id, {
      stage: stateResult.review.length ? "needs_review" : "complete",
      result,
      artifact_id: artifact?.id ?? null,
    });
    await activity(
      value.project_id,
      agent,
      `Automated write-back saved${artifact ? ` ${artifact.data.name}` : ""}; ${stateResult.accepted.length} changes accepted${stateResult.review.length ? `; ${stateResult.review.length} need review` : ""}`,
      {
        action_type: "commit_work",
        ingestion_run_id: reserved.run.id,
        artifact_id: artifact?.id ?? null,
        accepted_count: stateResult.accepted.length,
        review_count: stateResult.review.length,
      },
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await update("ingestion_runs", reserved.run.id, {
      stage: artifact ? "artifact_saved_needs_retry" : "failed",
      error: message,
      artifact_id: artifact?.id ?? null,
    });
    await activity(value.project_id, agent, "Automated write-back failed", {
      action_type: "error",
      ingestion_run_id: reserved.run.id,
      artifact_id: artifact?.id ?? null,
      error: message,
    });
    throw error;
  }
}
