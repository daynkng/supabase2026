# Verification status

## Passed locally

- TypeScript strict type checking.
- Next.js optimized production build.
- 7 domain checks: budget arithmetic, reservation effects, payment monotonicity, permission guards, operation validation, duplicate normalization.
- 15 database/protocol checks on embedded PostgreSQL with pgvector: idempotent writes, revision conflicts, cross-project mutation guards, superseded history, personal-only retrieval, persisted packs, provider-failure visibility, concurrent reservations, payment event deduplication and ordering, exact Napa totals, forged webhook rejection, filtered vector retrieval, artifact page preservation, and MCP initialization/tool discovery/read.
- Browser inspection of the actual application at desktop and 390px mobile widths; projects navigation, Napa overview and budget rendering.

Tests use a disposable embedded PostgreSQL/PGlite instance and synthetic Stripe event fixtures. The connection adapter serializes transactions; cloud multi-connection behavior still needs a real Supabase run. No model response, payment, or client handoff has been falsely labeled as live.

## Awaiting environment configuration

The supplied GitHub repository initially contained only a README. No provider environment file, GitHub repository secrets, or local Vercel login was available during implementation.

Therefore these are **not yet verified**:

- Migration/seed on the user's Supabase project.
- Live Claude extraction and ranking.
- Live Gemini file parsing and embeddings.
- Supabase original-file upload/download.
- Real Stripe test Checkout and webhook delivery.
- Public Vercel deployment.
- Actual ChatGPT and Claude client calls to that deployment.

## Deliberate implementation limits

- Public, synthetic, single-owner workspace; no identity/authentication or production permission enforcement.
- Compact relational tables with JSONB entity payloads and validated application interfaces.
- Context compilation selects original source-backed records and trims optional excerpts; it does not synthesize arbitrary compressed replacements for canonical decisions.
- Token target uses a character approximation, not provider token accounting.
- Parent-artifact derivation and replacement-version lineage are separate: a new memo may derive from research without removing the research's canonical status.
- Bounded awaited ingestion can time out on hosted plan limits; failed stages can be retried. There is no persistent worker queue.
- Unsupported file formats are preserved but not parsed. Initial parsed limits: 10 MB / 20 PDF pages.
- Optional audio/video, native Office generation, refunds, automatic project inference, and conversation scraping are not implemented.
- Reset clears demo database records but retains original Storage objects.

## Continuation changes

- Stable Stripe Checkout parameters across idempotent retries; uses Stripe's default session expiration.
- Late payment events preserve the original confirmation timestamp, covered by regression assertion.
- Node's direct TypeScript test loader avoids the tsx CLI's IPC socket requirement.
- Added `verify:deployment` for real HTTP MCP smoke checks; not yet run against a public deployment.
- Supports current Supabase server secret keys alongside legacy service-role keys.

## Link Agent Wallet addition

Added protected test-purchase requests, OAuth/PKCE, encrypted token storage and rotation, approval UI, provider status synchronization, and a file-based test-card handoff. Seven wallet regression checks exercise the actual SDK against mocked HTTP and embedded PostgreSQL. Live Link authorization, merchant execution, and real ChatGPT/Claude wallet calls remain unverified. See LINK-WALLET.md for explicit execution and client-authentication limits.

## Automated agent write-back

`commit_work` is covered for artifact plus state writes, idempotent retries, request-ID conflicts, empty/casual output, review proposals, preserved provenance and artifacts after extraction failure, cross-agent retrieval, permission guards, payment-dependent task guards, activity attribution, and MCP discovery. Actual client compliance with MCP end-of-work instructions still requires the live ChatGPT and Claude acceptance run.
