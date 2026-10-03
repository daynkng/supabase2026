import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (process.env.CONFIRM_RESET !== "synthetic-demo")
  throw new Error(
    "Set CONFIRM_RESET=synthetic-demo to reset the disposable demo.",
  );
const { db, tables, transaction } = await import("../lib/db");
const { seed } = await import("../lib/seed");
const { OWNER } = await import("../lib/domain");
await transaction(async (c) => {
  for (const t of tables)
    await c.query(`DELETE FROM ${t} WHERE user_id=$1`, [OWNER]);
  for (const [t, rs] of Object.entries(seed()))
    for (const r of rs)
      await c.query(
        `INSERT INTO ${t}(id,user_id,project_id,data) VALUES($1,$2,$3,$4)`,
        [r.id, OWNER, r.project_id, JSON.stringify(r.data)],
      );
});
console.log(
  "Demo reset. Stored files are retained; remove unused objects separately.",
);
await db().end();
