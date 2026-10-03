import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { OWNER, AppError, active } from "./domain";
import {
  get,
  rows,
  insert,
  update,
  activity,
  transaction,
  lockScope,
  db,
} from "./db";
import { storage } from "./storage";
import { parseFile, embed } from "./models";
import { ingestOutput } from "./state";
export async function beginUpload(
  project: string,
  name: string,
  mime: string,
  size: number,
  parent?: string,
  replaces?: string,
  metadata: Record<string, unknown> = {},
) {
  await get("projects", project);
  z.number().int().positive().max(10485760).parse(size);
  const id = crypto.randomUUID();
  const path = `${project}/${id}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  if (parent) {
    const p = await get("artifacts", parent);
    if (p.project_id !== project)
      throw new AppError("Parent artifact scope mismatch");
  }
  const previous = replaces ? await get("artifacts", replaces) : null;
  if (previous && previous.project_id !== project)
    throw new AppError("Replacement artifact scope mismatch");
  const { data, error } = await storage().createSignedUploadUrl(path);
  if (error) throw error;
  const a = await insert(
    "artifacts",
    project,
    {
      name,
      mime_type: mime,
      storage_path: path,
      status: "active",
      processing_status: "awaiting_upload",
      size,
      created_by_agent: "Human",
      is_canonical: false,
      version: previous ? previous.data.version + 1 : 1,
      parent_artifact_id: parent ?? previous?.id ?? null,
      replaces_artifact_id: previous?.id ?? null,
      lineage_id: previous ? previous.data.lineage_id : id,
      ...metadata,
    },
    undefined,
    id,
  );
  return { artifact: a, upload_url: data.signedUrl };
}
export async function saveText(
  project: string,
  name: string,
  text: string,
  agent: string,
  parent?: string,
  replaces?: string,
  options: { requestId?: string; process?: boolean } = {},
) {
  z.string().max(200000).parse(text);
  const contentFingerprint = createHash("sha256").update(text).digest("hex");
  const existing = options.requestId
    ? (await rows("artifacts", project)).find(
        (artifact) => artifact.data.commit_request_id === options.requestId,
      )
    : undefined;
  if (
    existing &&
    (existing.data.name !== name ||
      existing.data.content_fingerprint !== contentFingerprint)
  )
    throw new AppError(
      "Artifact request ID reused with different content",
      409,
    );
  const a =
    existing ??
    (
      await beginUpload(
        project,
        name,
        "text/markdown",
        Math.max(1, Buffer.byteLength(text)),
        parent,
        replaces,
        options.requestId
          ? {
              commit_request_id: options.requestId,
              content_fingerprint: contentFingerprint,
            }
          : {},
      )
    ).artifact;
  if (
    a.data.processing_status === "complete" ||
    a.data.processing_status === "stored"
  ) {
    if (!a.data.is_canonical) await canonical(a.id);
    return get("artifacts", a.id);
  }
  const { error } = await storage().upload(a.data.storage_path, text, {
    contentType: "text/markdown",
    upsert: true,
  });
  if (error) throw error;
  await update("artifacts", a.id, {
    created_by_agent: agent,
    text_content: text,
    processing_status: "stored",
    summary: text.slice(0, 300),
  });
  await activity(project, agent, `Saved ${name}`, { artifact_id: a.id });
  await canonical(a.id);
  if (options.process === false) return get("artifacts", a.id);
  try {
    await processArtifact(a.id);
  } catch {
    /* The original remains saved and its processing failure is visible. */
  }
  return get("artifacts", a.id);
}
export async function canonical(id: string) {
  return transaction(async (c) => {
    const a = await get("artifacts", id, c);
    await lockScope(c, a.project_id);
    if (!active(a)) throw new AppError("Archived artifact cannot be canonical");
    for (const other of await rows("artifacts", a.project_id, c))
      if (
        other.data.lineage_id === a.data.lineage_id &&
        other.data.is_canonical
      )
        await update("artifacts", other.id, { is_canonical: false }, c);
    await update("artifacts", id, { is_canonical: true }, c);
    await update("projects", a.project_id!, {}, c);
    return { ok: true };
  });
}
export async function processArtifact(id: string) {
  const a = await get("artifacts", id);
  if (!active(a)) throw new AppError("Artifact is archived");
  const claimed = await db().query(
    "UPDATE artifacts SET data=data || '{\"processing_status\":\"parsing\"}'::jsonb,updated_at=now() WHERE id=$1 AND (data->>'processing_status' NOT IN ('parsing','extracting','indexing') OR updated_at<now()-interval '5 minutes') RETURNING *",
    [id],
  );
  if (!claimed.rowCount)
    throw new AppError("Artifact is already processing", 409);
  const run = await insert("ingestion_runs", a.project_id, {
    stage: "parsing",
    artifact_id: id,
  });
  try {
    const { data, error } = await storage().download(a.data.storage_path);
    if (error) throw error;
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length > 10485760) throw new AppError("Artifact exceeds 10 MB");
    const mime = a.data.mime_type;
    if (mime === "application/pdf") {
      const pdf = await PDFDocument.load(bytes);
      if (pdf.getPageCount() > 20) throw new AppError("PDF exceeds 20 pages");
    }
    if (
      ![
        "application/pdf",
        "image/png",
        "image/jpeg",
        "text/markdown",
        "text/plain",
      ].includes(mime)
    ) {
      await update("artifacts", id, {
        processing_status: "stored",
        summary:
          a.data.summary ??
          "Original preserved. Automatic parsing is not supported for this format.",
      });
      await update("ingestion_runs", run.id, { stage: "complete" });
      return get("artifacts", id);
    }
    const parsed = mime.startsWith("text/")
      ? { passages: [{ locator: "document", text: bytes.toString("utf8") }] }
      : await parseFile(bytes, mime);
    const passages = z
      .array(
        z.object({ locator: z.string().max(200), text: z.string().max(60000) }),
      )
      .max(100)
      .parse(parsed.passages);
    await transaction(async (c) => {
      await c.query(
        "DELETE FROM artifact_chunks WHERE data->>'artifact_id'=$1 AND user_id=$2",
        [id, OWNER],
      );
      for (const p of passages) {
        for (let i = 0; i < p.text.length; i += 5000)
          await insert(
            "artifact_chunks",
            a.project_id,
            {
              artifact_id: id,
              locator: p.locator,
              text: p.text.slice(i, i + 5000),
            },
            c,
          );
      }
    });
    await update("artifacts", id, {
      processing_status: "extracting",
      summary: passages
        .map((p) => p.text)
        .join("\n")
        .slice(0, 500),
    });
    await update("ingestion_runs", run.id, { stage: "extracting" });
    const source = await insert("sources", a.project_id, {
      source_type: "artifact",
      artifact_id: id,
      source_agent: "Gemini",
      excerpt: passages
        .map((p) => `${p.locator}: ${p.text}`)
        .join("\n")
        .slice(0, 60000),
    });
    const result = await ingestOutput(
      a.project_id!,
      `Artifact ${id}, source ${source.id}:\n${source.data.excerpt}`,
      "Gemini → Claude",
      `artifact:${id}`,
      source.id,
    );
    let pending = 0;
    await update("artifacts", id, { processing_status: "indexing" });
    for (const chunk of (await rows("artifact_chunks", a.project_id)).filter(
      (r) => r.data.artifact_id === id,
    )) {
      try {
        const v = await embed(chunk.data.text);
        await db().query(
          "UPDATE artifact_chunks SET embedding=$1::vector WHERE id=$2",
          [JSON.stringify(v), chunk.id],
        );
      } catch {
        pending++;
      }
    }
    await update("artifacts", id, {
      processing_status: pending ? "indexing_failed" : "complete",
      processing_error: pending
        ? "Some passages need indexing. Retry processing."
        : null,
    });
    await update("ingestion_runs", run.id, {
      stage: pending ? "indexing_failed" : "complete",
      result,
    });
    await activity(
      a.project_id,
      "Gemini → Claude",
      `Processed ${a.data.name}`,
      { artifact_id: id },
    );
    return get("artifacts", id);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Parsing failed";
    await update("artifacts", id, {
      processing_status: "failed",
      processing_error: error,
    });
    await update("ingestion_runs", run.id, { stage: "failed", error });
    await activity(a.project_id, "System", `Could not process ${a.data.name}`, {
      action_type: "error",
      error,
      artifact_id: id,
    });
    throw e;
  }
}
