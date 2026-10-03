# Shared State

A Context Control Center and shared MCP backend for ChatGPT and Claude. Structured project state, relevant personal context, and source-linked artifacts survive agent handoffs.

## Included

- Responsive projects, personal context, tasks, artifacts, activity, Context Inspector, connections, and budget screens.
- PostgreSQL-backed validated writes, optimistic revisions, idempotent requests, version history, and provenance.
- Claude extraction and context selection; Gemini PDF/image parsing and 768-dimensional embeddings; pgvector scope-filtered retrieval.
- Private Supabase artifact storage and expiring download links.
- Nine public Streamable HTTP MCP tools, including the standard `commit_work` end-of-work write-back, plus two protected Link Agent Wallet test-purchase tools.
- Link OAuth/PKCE, encrypted token storage, human approval, budget reservations, and secure test-credential handoff. See [wallet setup and limits](docs/LINK-WALLET.md).
- Stripe **test-only** human Checkout, atomic budget reservations, verified/idempotent webhooks, and simulated booking task updates.
- Synthetic market research and Napa seed projects; no invented research or pre-completed payments.

## Start

Requires Node.js 22+ and a dedicated Supabase project.

```sh
npm ci
cp .env.example .env.local
# Fill in .env.local locally; never commit it.
npm run db:setup
npm run dev
```

Without `DATABASE_URL`, the UI explicitly displays **Setup preview** using read-only seed fixtures. Provider-backed actions do not silently simulate success. If a database is configured but unavailable, the app shows the real error rather than falling back to fixtures.

The database layer uses `pg` against Supabase Postgres for atomic transactions and advisory locks. Supabase's service-role API key is used only on the server for private Storage. Do not put either credential in `NEXT_PUBLIC_*` settings.

## Documentation

- [Deployment and provider setup](docs/SETUP.md)
- [Architecture, data contracts, and API](docs/ARCHITECTURE.md)
- [Both demonstration scripts](docs/DEMO.md)
- [Verification and limitations](docs/VERIFICATION.md)

## Checks

```sh
npm run typecheck
npm test
npm run test:integration
npm run build
```

Connected agents follow `list_projects` → `get_context` → work → `commit_work`. The final call saves an optional text deliverable and extracts supported durable state without requiring pasted transcripts. Existing `ingest_output`, `save_artifact`, and `write_update` tools remain available for advanced and recovery workflows.

Integration tests run a disposable PostgreSQL engine with pgvector through PGlite. No cloud credentials are required. They validate the production SQL and service functions, with a serialized connection adapter. Real multi-connection Supabase testing and provider/client verification still require deployment credentials.

## Public synthetic demo boundary

Set `DEMO_PUBLIC=true` only for a dedicated disposable workspace. The application and MCP endpoint have **no end-user authentication**. Anyone with access can read and modify synthetic data and trigger configured provider calls. Do not store personal information, real receipts, production keys, or real payment data. Stripe live keys and live events are rejected.

Models cannot change permission records or directly write financial state. These guarantees concern the agent tool interface; unauthenticated UI actions are intentionally available to every visitor of the synthetic demo. This is not a production permissions system.

## Reset

Operator-only, no HTTP reset endpoint:

```sh
CONFIRM_RESET=synthetic-demo npm run demo:reset
```

This resets database records for the fixed demo owner. Original Storage objects are retained; remove unused files separately in the dedicated Supabase project if needed.
