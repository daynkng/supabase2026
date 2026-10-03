import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { db, transaction } = await import("../lib/db");
const { seed } = await import("../lib/seed");
const { readFile, readdir } = await import("node:fs/promises");
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db().query(await readFile(`supabase/migrations/${file}`, "utf8"));
await transaction(async (c) => {
  for (const [table, records] of Object.entries(seed()))
    for (const r of records)
      await c.query(
        `INSERT INTO ${table}(id,user_id,project_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
        [r.id, r.user_id, r.project_id, JSON.stringify(r.data)],
      );
});
console.log("Schema and synthetic seed ready.");
await db().end();
