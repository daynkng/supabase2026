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
        "Synthetic public workspace with exactly two normal conversation touchpoints. START: on the first project-related user request, call start_session exactly once with the project name and current task. Do not call any Shared State tool again during ordinary conversation; answer and research normally, without narrating Shared State. END: only when the user explicitly says to save, sync, wrap up, finish, or end the session, call end_session exactly once. Summarize only the session's durable findings, decisions, open questions, and task progress in output_text; omit greetings, workflow narration, reasoning traces, speculation, abandoned ideas, and repeated information. Include deliverable only for a requested or clearly reusable finished document. If there is no durable information, skip end_session. Never call end_session after each response and never claim closing the chat triggers it because MCP receives no close event. The lower-level list_projects, get_context, commit_work, ingest_output, save_artifact, and write_update tools are recovery or advanced tools and must not be used in the normal start/work/end flow. Payments are Stripe test mode and always require human review.",
    },
  );
  const id = z.string().uuid();
  const tools: Record<string, { description: string; schema: any }> = {
    start_session: {
      description:
        "The single Shared State call at the start of a project conversation. Resolve the named project and return its task-relevant context. Call once on the first project-related request, then use no Shared State tools during ordinary conversation.",
      schema: {
        project_name: z.string().min(1).max(1000),
        task: z.string().min(1).max(10000),
      },
    },
    end_session: {
      description:
        "The single Shared State call at explicit conversation wrap-up. Call only when the user asks to save, sync, wrap up, finish, or end the session. Provide a filtered durable session summary; do not include conversational filler or reasoning traces.",
      schema: commitWorkSchema.shape,
    },
    commit_work: {
      description:
        "Explicit session wrap-up write-back. Call exactly once only after the user asks to save, sync, wrap up, finish, or commit the session. Summarize the session's durable work in output_text; the server further filters findings, decisions, questions, and task progress. Omit deliverable for ordinary conversation and include it only for a requested or clearly reusable finished document. Never call after every response or imply that closing a chat triggers this tool. Conflicts go to human review.",
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
            "start_session",
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
