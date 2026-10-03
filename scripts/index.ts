import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { rows, db } = await import("../lib/db");
const { indexPending } = await import("../lib/state");
console.log("Personal context:", await indexPending(null));
for (const p of await rows("projects"))
  console.log(p.data.name, await indexPending(p.id));
await db().end();
