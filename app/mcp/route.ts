import { requireWalletAccess } from "@/lib/wallet-auth";
import {
  requestWalletPayment,
  refreshWalletPayment,
  walletRequestSchema,
} from "@/lib/wallet";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { execute } from "@/lib/service";
import { deltaSchema } from "@/lib/domain";
import { activity } from "@/lib/db";
import { commitWorkSchema } from "@/lib/commit-work";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  if (process.env.DEMO_PUBLIC !== "true")
    return Response.json(
      { error: "Synthetic public demo is not enabled" },
      { status: 503 },
    );
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  const server = new McpServer(
    { name: "Shared State", version: "0.1.0" },
    {
      instructions:
        "Synthetic public workspace. Required operating loop for meaningful project work: (1) use list_projects to resolve the project, (2) call get_context before acting, (3) do the requested work in your client, and (4) call commit_work exactly once with the final meaningful output and any text deliverable. Do not call commit_work for acknowledgements, casual conversation, brainstorming, abandoned drafts, or output with no durable project information. Use ingest_output, save_artifact, and write_update only for advanced or recovery workflows. Read the current project revision before write_update. Payments are Stripe test mode and always require human review.",
    },
  );
  const id = z.string().uuid();
  const tools: Record<string, { description: string; schema: any }> = {
    commit_work: {
      description:
        "Standard end-of-work write-back. Call exactly once after meaningful project work to save an optional text deliverable and extract durable findings, decisions, questions, and task progress. Skip casual or abandoned output. Conflicts go to human review.",
      schema: commitWorkSchema.shape,
    },
    request_wallet_payment: {
      description:
        "Request a human-approved Link Agent Wallet TEST purchase. Requires operator bearer authorization. Returns approval URL, never payment credentials.",
      schema: walletRequestSchema.shape,
    },
    get_wallet_payment: {
      description:
        "Refresh a Link test purchase from the provider. Approval is not payment. Requires operator bearer authorization.",
      schema: { id },
    },
    list_projects: {
      description: "Discover shared project IDs and goals.",
      schema: {},
    },
    get_project_state: {
      description: "Read broader state and current project revision.",
      schema: { project_id: id },
    },
    get_context: {
      description:
        "Get task-relevant shared context before acting. Omit project only for personal context.",
      schema: {
        task: z.string().min(1).max(10000),
        project_id: id.optional(),
        intent: z.enum(["research", "write", "plan", "payment"]).optional(),
      },
    },
    write_update: {
      description:
        "Persist explicit durable state changes. Cannot approve payments or modify permissions.",
      schema: {
        project_id: id,
        state_delta: deltaSchema,
        request_id: z.string().min(1),
        expected_revision: z.number().int(),
      },
    },
    ingest_output: {
      description:
        "Use Claude to extract durable changes from meaningful output.",
      schema: {
        project_id: id,
        text: z.string().max(60000),
        source_agent: z.string(),
        request_id: z.string().min(1),
      },
    },
    save_artifact: {
      description:
        "Save text content or process an application upload reference.",
      schema: {
        project_id: id,
        artifact: z.object({
          name: z.string().optional(),
          text: z.string().max(200000).optional(),
          upload_reference: id.optional(),
          parent_artifact_id: id.optional(),
          replaces_artifact_id: id.optional(),
        }),
      },
    },
    search_artifacts: {
      description: "Find relevant shared artifacts.",
      schema: { project_id: id, query: z.string() },
    },
    request_payment: {
      description:
        "Reserve demo budget and return human payment review URL. Does not charge or approve payment.",
      schema: {
        project_id: id,
        amount_cents: z.number().int().positive(),
        category: z.string(),
        description: z.string(),
        request_id: z.string().optional(),
      },
    },
  };
  for (const [name, tool] of Object.entries(tools))
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: [
            "list_projects",
            "get_project_state",
            "get_context",
            "search_artifacts",
          ].includes(name),
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args: any) => {
        const client =
          server.server.getClientVersion()?.name ??
          req.headers.get("user-agent") ??
          "MCP client";
        try {
          let result;
          if (["request_wallet_payment", "get_wallet_payment"].includes(name)) {
            requireWalletAccess(req, true);
            result =
              name === "request_wallet_payment"
                ? await requestWalletPayment(args)
                : await refreshWalletPayment(args.id);
          } else result = await execute(name, args, false, client);
          await activity(
            args.project_id ?? null,
            client,
            `MCP ${name} succeeded`,
            { action_type: "tool_call", tool: name },
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: e instanceof Error ? e.message : "Tool failed",
              },
            ],
          };
        }
      },
    );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}
export async function GET() {
  return new Response(
    "Use Streamable HTTP POST for this stateless MCP endpoint.",
    { status: 405, headers: { Allow: "POST" } },
  );
}
export const DELETE = GET;
