import { OWNER, Row, active, ref, budget } from "./domain";
import { rows, get, db, insert } from "./db";
import { embed, claude } from "./models";
import { signedDownload } from "./storage";
export async function semantic(
  table: "context_items" | "artifact_chunks",
  project: string | null,
  vector: number[],
  limit: number,
): Promise<Row[]> {
  const scope = project ? "r.project_id=$3" : "r.project_id IS NULL";
  const status =
    table === "context_items"
      ? "r.data->>'status'='active'"
      : "EXISTS(SELECT 1 FROM artifacts a WHERE a.id=(r.data->>'artifact_id')::uuid AND a.user_id=r.user_id AND a.project_id=r.project_id AND a.data->>'status'='active')";
  return (
    await db().query(
      `SELECT r.* FROM ${table} r WHERE r.user_id=$1 AND ${scope} AND ${status} AND r.embedding IS NOT NULL ORDER BY r.embedding <=> $2::vector LIMIT ${limit}`,
      project
        ? [OWNER, JSON.stringify(vector), project]
        : [OWNER, JSON.stringify(vector)],
    )
  ).rows;
}
export async function contextPack(
  task: string,
  projectId?: string,
  actor = "UI",
) {
  const project = projectId ? await get("projects", projectId) : null;
  const [personal, context, tasks, artifacts, transactions] = await Promise.all(
    [
      rows("context_items", null),
      project ? rows("context_items", project.id) : [],
      project ? rows("tasks", project.id) : [],
      project ? rows("artifacts", project.id) : [],
      project ? rows("transactions", project.id) : [],
    ],
  );
  const mandatory = context.filter(
    (r) => active(r) && ["constraint", "decision"].includes(r.data.kind),
  );
  const permissions = personal.filter(
    (r) => active(r) && r.data.kind === "permission",
  );
  const warnings: string[] = [];
  let selected: Row[] = [];
  let chunks: Row[] = [];
  let mode = "compiled";
  try {
    const vector = await embed(task);
    const [pc, cc, ac] = await Promise.all([
      semantic("context_items", null, vector, 10),
      project ? semantic("context_items", project.id, vector, 20) : [],
      project ? semantic("artifact_chunks", project.id, vector, 12) : [],
    ]);
    const candidates = [...pc, ...cc];
    const chosen = await claude(
      "Select only context needed for the task. Return {item_ids:string[], chunk_ids:string[]}. Use only supplied IDs. Exclude unrelated personal details, repeated facts, unsupported claims, and irrelevant completed work. This is selection only; do not rewrite authoritative data.",
      { task, project: project?.data, candidates, passages: ac },
    );
    const ids = new Set(Array.isArray(chosen.item_ids) ? chosen.item_ids : []);
    const cids = new Set(
      Array.isArray(chosen.chunk_ids) ? chosen.chunk_ids : [],
    );
    if (
      [...ids].some((id) => !candidates.some((c) => c.id === id)) ||
      [...cids].some((id) => !ac.some((c) => c.id === id))
    )
      throw new Error("Compiler returned invalid source references");
    selected = candidates.filter((r) => ids.has(r.id));
    chunks = ac.filter((r) => cids.has(r.id));
    if (
      !cc.length &&
      context.some((r) => active(r) && r.data.kind === "knowledge")
    )
      warnings.push("Some knowledge may be awaiting indexing.");
  } catch (e) {
    mode = "structured_only";
    selected = context.filter(active);
    warnings.push(
      e instanceof Error ? e.message : "Semantic retrieval unavailable",
    );
  }
  const all = [
    ...new Map([...mandatory, ...selected].map((r) => [r.id, r])).values(),
  ];
  const relevantArtifacts = artifacts.filter(
    (r) =>
      active(r) &&
      (r.data.is_canonical || chunks.some((c) => c.data.artifact_id === r.id)),
  );
  const artifactRefs = await Promise.all(
    relevantArtifacts.map(async (a) => {
      let url;
      try {
        if (a.data.storage_path)
          url = await signedDownload(a.data.storage_path);
      } catch {
        warnings.push(`Download link unavailable for ${a.data.name}`);
      }
      return {
        id: a.id,
        name: a.data.name,
        summary: a.data.summary,
        is_canonical: a.data.is_canonical,
        download_url: url,
        excerpts: chunks
          .filter((c) => c.data.artifact_id === a.id)
          .map((c) => ({
            id: c.id,
            artifact_id: a.id,
            locator: c.data.locator,
            text: c.data.text,
          })),
      };
    }),
  );
  const pack: any = {
    project: project
      ? {
          id: project.id,
          name: project.data.name,
          goal: project.data.goal,
          status: project.data.status,
          revision: project.revision,
        }
      : null,
    personal_context: all
      .filter(
        (r) =>
          !r.project_id && !["permission", "constraint"].includes(r.data.kind),
      )
      .map(ref),
    constraints: all.filter((r) => r.data.kind === "constraint").map(ref),
    permissions: permissions.map(ref),
    knowledge: all
      .filter((r) => r.project_id && r.data.kind === "knowledge")
      .map(ref),
    decisions: all
      .filter((r) => r.project_id && r.data.kind === "decision")
      .map(ref),
    open_questions: all
      .filter((r) => r.project_id && r.data.kind === "open_question")
      .map(ref),
    project_preferences: all
      .filter((r) => r.project_id && r.data.kind === "preference")
      .map(ref),
    tasks: tasks
      .filter((r) => r.data.status !== "completed")
      .map((r) => ({ id: r.id, title: r.data.title, status: r.data.status })),
    artifacts: artifactRefs,
    ...(project?.data.budget_total_cents !== undefined
      ? { budget: budget(project, transactions) }
      : {}),
    meta: {
      generated_at: new Date().toISOString(),
      retrieval_mode: mode,
      warnings,
    },
  };
  while (
    JSON.stringify(pack).length > 16000 &&
    pack.artifacts.some((a: any) => a.excerpts.length)
  )
    pack.artifacts.find((a: any) => a.excerpts.length).excerpts.pop();
  while (JSON.stringify(pack).length > 16000 && pack.knowledge.length)
    pack.knowledge.pop();
  if (JSON.stringify(pack).length > 16000)
    warnings.push(
      "Mandatory state exceeds the approximate 4,000-token target; no required rules were dropped.",
    );
  await insert("context_retrievals", projectId ?? null, { task, actor, pack });
  return pack;
}
export async function searchArtifacts(project: string, query: string) {
  await get("projects", project);
  const artifacts = (await rows("artifacts", project)).filter(active);
  try {
    const v = await embed(query);
    const chunks = await semantic("artifact_chunks", project, v, 12);
    return {
      mode: "semantic",
      artifacts: artifacts.filter(
        (a) =>
          chunks.some((c) => c.data.artifact_id === a.id) ||
          a.data.name.toLowerCase().includes(query.toLowerCase()),
      ),
      chunks,
    };
  } catch (e) {
    return {
      mode: "text_fallback",
      warning: e instanceof Error ? e.message : "Embedding unavailable",
      artifacts: artifacts.filter((a) =>
        `${a.data.name} ${a.data.summary ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
      chunks: [],
    };
  }
}
