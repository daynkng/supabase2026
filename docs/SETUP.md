# Setup and deployment

## 1. Environment

Copy `.env.example` to `.env.local`. Keep the file ignored by Git.

| Variable                | Purpose                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Supabase Postgres connection string; use session pooler or direct endpoint with SSL enabled |
| `SUPABASE_URL`          | Supabase project URL                                                                        |
| `SUPABASE_SECRET_KEY`   | Server-only Storage access (legacy `SUPABASE_SERVICE_ROLE_KEY` also accepted)               |
| `ANTHROPIC_API_KEY`     | Claude state extraction and context compilation                                             |
| `CLAUDE_MODEL`          | Account-accessible Claude model ID                                                          |
| `GEMINI_API_KEY`        | Google AI parsing and embeddings                                                            |
| `GEMINI_MODEL`          | Account-accessible multimodal Gemini model                                                  |
| `EMBEDDING_MODEL`       | Consistent embedding model for writes and queries                                           |
| `STRIPE_SECRET_KEY`     | `sk_test_…` key only                                                                        |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the deployed webhook                                                     |
| `NEXT_PUBLIC_APP_URL`   | Actual public HTTPS origin, without trailing slash                                          |
| `DEMO_PUBLIC`           | Explicitly set to `true` for synthetic demo use                                             |

If the password contains reserved URL characters, use the escaped connection string supplied by Supabase. Never disable certificate validation to work around connection errors.

## 2. Supabase

Use a dedicated project. Run `npm run db:setup` with the environment loaded. The migration creates tables, pgvector indexes, scope constraints, request/event uniqueness, and a private `artifacts` bucket capped at 10 MB.

All public tables enable RLS and have no anonymous policies. Browser and MCP clients use server endpoints; they cannot query the Supabase tables directly. The database connection must have the appropriate server privileges.

Seed data includes two projects, pending tasks, personal preferences, and explicit synthetic-source provenance. Run indexing from Project → Context → Retry indexing after configuring Gemini. Run `npm run db:index` to index personal context and all pending project items after configuring Gemini.

## 3. Vercel

Import this repository as a Next.js project. Root directory is the repository root. Use Node.js 22 and default `npm run build` settings.

Add the variables above to the Vercel environment. Set `NEXT_PUBLIC_APP_URL` to the deployed origin and redeploy. API routes use Node.js; artifact processing permits up to 300 seconds, subject to your Vercel plan's actual limits. Large or slow jobs can time out and must be retried; no durable worker service is included.

The local filesystem is not used for canonical state or uploaded artifacts.

## 4. Stripe test webhook

Register:

```text
https://YOUR-DEPLOYMENT/api/stripe/webhook
```

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Save that endpoint's signing secret in Vercel and redeploy. For local testing, use Stripe CLI forwarding to `/api/stripe/webhook` and its locally issued signing secret.

Use Stripe test card `4242 4242 4242 4242`, any future expiration, and any test CVC in the human checkout flow. Never use a real card. A return to the app does not prove payment success: the verified webhook is authoritative.

## 5. Connect both agents

Endpoint:

```text
https://YOUR-DEPLOYMENT/mcp
```

Use Streamable HTTP and no authentication only for this synthetic demo.

- ChatGPT: enable developer mode, add the custom MCP connection, and enable it in a conversation.
- Claude: add a custom remote connector and enable it in the conversation.

Have each client call `list_projects` and `get_context`. Check the Connections page and activity timeline for observed successful calls. Client names are best-effort, untrusted provenance labels, not authenticated identities. The stateless endpoint may only have the HTTP user-agent on post-initialization calls.

A localhost URL will not work from cloud clients. Use the public Vercel URL. Account permissions may affect the exact client menus.

## 6. Live acceptance

Run both scripts in `DEMO.md`. Confirm each model call, PDF parse, artifact upload/download, actual agent tool call, and Stripe test webhook. A green configuration badge only means the environment variable exists; it is not a connectivity test.

## Deployment smoke check

```sh
npm run verify:deployment -- https://YOUR-DEPLOYMENT
```

Uses the real MCP SDK over HTTP to initialize, discover all eleven tools, retrieve both seeded projects and their context, and check personal-only scope. Calls persist normal retrieval/activity records and may use configured model providers. Structured-only fallback and provider warnings remain visible. This does not substitute for actual ChatGPT/Claude client handoffs or Stripe Checkout.

The Supabase HTTPS project URL is not a PostgreSQL connection string. Obtain `DATABASE_URL` from the dashboard's **Connect** dialog (direct or session pooler), insert the database password, and save it in the ignored `.env.local`. The publishable key and JWKS URL are not required by this single-owner backend.

## Link Agent Wallet

See [Link Agent Wallet setup](LINK-WALLET.md) for the separate OAuth client, protected wallet controls, test purchase flow, and agent credential handoff. Stripe secret keys do not authenticate the Link API.
