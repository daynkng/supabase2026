import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";

loadEnvConfig(process.cwd());
const origin = process.argv[2] || process.env.NEXT_PUBLIC_APP_URL;
if (!origin)
  throw new Error(
    "Supply the deployed origin: npm run verify:deployment -- https://your-app.example",
  );
const endpoint = new URL("/mcp", origin);
if (!["https:", "http:"].includes(endpoint.protocol))
  throw new Error("Expected an HTTP(S) URL");
const client = new Client({
  name: "shared-state-deployment-check",
  version: "0.1.0",
});
const transport = new StreamableHTTPClientTransport(endpoint);
const timeout = setTimeout(() => {
  console.error("Deployment check timed out after 90 seconds.");
  process.exit(1);
}, 90_000);
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const expected = [
    "start_session",
    "end_session",
    "list_projects",
    "get_context",
    "get_project_state",
    "ingest_output",
    "write_update",
    "save_artifact",
    "search_artifacts",
    "request_payment",
    "commit_work",
    "request_wallet_payment",
    "get_wallet_payment",
  ];
  for (const name of expected)
    assert(
      tools.some((t) => t.name === name),
      `Missing tool: ${name}`,
    );
  console.log(`PASS MCP initialization and all ${tools.length} tools`);
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, `${name} returned a tool error`);
    const content = result.content as { type: string; text?: string }[];
    const text = content.find((c) => c.type === "text")?.text;
    assert(text, `${name} returned no text`);
    return JSON.parse(text);
  }
  const projects: { id: string; data: { name: string } }[] = await call(
    "list_projects",
    {},
  );
  assert(
    Array.isArray(projects) && projects.length >= 2,
    "Expected both seeded demonstration projects",
  );
  for (const name of ["AI Agent Market Research", "Napa Weekend"]) {
    const project = projects.find((p) => p.data?.name === name);
    assert(project, `Missing demonstration project: ${name}`);
    const state = await call("get_project_state", { project_id: project.id });
    assert.equal(state.projects.length, 1);
    assert.equal(state.projects[0].id, project.id);
    const pack = await call("get_context", {
      project_id: project.id,
      task: "Summarize current decisions and remaining tasks",
    });
    assert.equal(pack.project.id, project.id);
    assert(pack.meta?.generated_at, "Missing context retrieval metadata");
    console.log(
      `PASS ${name}: state and context retrieval (${pack.meta.retrieval_mode})`,
    );
    if (pack.meta.warnings?.length)
      console.log(`  Warnings: ${JSON.stringify(pack.meta.warnings)}`);
  }
  const personal = await call("get_context", {
    task: "Summarize my working preferences",
  });
  assert.equal(personal.project, null);
  assert.equal(personal.tasks.length, 0);
  console.log("PASS personal-only scope");
  console.log(
    "Deployment smoke check passed. Real ChatGPT/Claude handoffs, uploads, and Stripe Checkout still require the live demo steps in docs/DEMO.md.",
  );
} finally {
  clearTimeout(timeout);
  await client.close();
}
