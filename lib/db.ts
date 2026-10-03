import pg from "pg";
import { OWNER, Row, AppError } from "./domain";
export const tables = [
  "users",
  "projects",
  "context_items",
  "sources",
  "tasks",
  "artifacts",
  "artifact_chunks",
  "activities",
  "ingestion_runs",
  "context_retrievals",
  "transactions",
  "processed_stripe_events",
] as const;
export type Table = (typeof tables)[number];
let pool: pg.Pool;
export function useTestPool(testPool: pg.Pool) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Test pool is only available in tests");
  pool = testPool;
}
export function configured() {
  return Boolean(process.env.DATABASE_URL);
}
export function db() {
  if (!configured())
    throw new AppError(
      "Database not configured. Add DATABASE_URL to .env.local and run npm run db:setup.",
      503,
    );
  return (pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
  }));
}
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function rows(
  table: Table,
  project?: string | null,
  c: pg.Pool | pg.PoolClient = db(),
): Promise<Row[]> {
  const q =
    project === undefined
      ? ""
      : project === null
        ? " AND project_id IS NULL"
        : " AND project_id=$2";
  return (
    await c.query(
      `SELECT * FROM ${table} WHERE user_id=$1${q} ORDER BY created_at DESC`,
      project ? [OWNER, project] : [OWNER],
    )
  ).rows;
}
export async function get(
  table: Table,
  id: string,
  c: pg.Pool | pg.PoolClient = db(),
): Promise<Row> {
  const r = (
    await c.query(`SELECT * FROM ${table} WHERE id=$1 AND user_id=$2`, [
      id,
      OWNER,
    ])
  ).rows[0];
  if (!r) throw new AppError("Record not found", 404);
  return r;
}
export async function insert(
  table: Table,
  project: string | null,
  data: Record<string, any>,
  c: pg.Pool | pg.PoolClient = db(),
  id = crypto.randomUUID(),
): Promise<Row> {
  return (
    await c.query(
      `INSERT INTO ${table}(id,user_id,project_id,data) VALUES($1,$2,$3,$4) RETURNING *`,
      [id, OWNER, project, JSON.stringify(data)],
    )
  ).rows[0];
}
export async function update(
  table: Table,
  id: string,
  data: Record<string, any>,
  c: pg.Pool | pg.PoolClient = db(),
) {
  return (
    await c.query(
      `UPDATE ${table} SET data=data || $3::jsonb, revision=revision+1, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id, OWNER, JSON.stringify(data)],
    )
  ).rows[0] as Row;
}
export async function lockScope(c: pg.PoolClient, project: string | null) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    project ?? OWNER,
  ]);
  return get(project ? "projects" : "users", project ?? OWNER, c);
}
export async function activity(
  project: string | null,
  actor: string,
  description: string,
  related: Record<string, any> = {},
  c: pg.Pool | pg.PoolClient = db(),
) {
  return insert(
    "activities",
    project,
    { actor, description, action_type: "update", ...related },
    c,
  );
}
