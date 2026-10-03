# Architecture and contracts

## Components

```text
ChatGPT / Claude ── MCP /mcp ─────────┐
                                    ├── shared application services
Context Control Center ─ /api/action ┘
                                          │
                         ┌────────────────┼─────────────────┐
                         │                │                 │
                    state writer      retrieval         artifacts
                         │                │                 │
                    Postgres       SQL + pgvector     Supabase Storage
                         ↑             + Claude        Gemini → Claude
                  Stripe webhooks
```

## Context hierarchy

Personal records have `project_id = NULL`, `scope = personal`. Project records have a project UUID and `scope = project`. Knowledge, decisions, preferences, constraints, working style, background, permissions, and open questions share `context_items`.

Separate tables hold tasks, artifacts, extracted chunks, activities, source records, ingestion attempts, context retrievals, and payments. `users` contains the single synthetic owner.

Each table has typed relational `id`, `user_id`, `project_id`, `revision`, `created_at`, `updated_at`, and a JSONB `data` payload. This keeps the hackathon schema compact while preserving independent entities, SQL filtering, transactional writes, and provenance. Context and artifact chunk embeddings are `vector(768)`. Indexes and CHECK constraints live in the migration. Do not treat the JSONB payload as permission for arbitrary agent writes: application schemas restrict accepted operations.

Context data: `kind`, `content`, `scope`, `status`, `confidence`, `source_id`, `source_agent`, optional `supersedes_id`, `indexing_status`.

Artifact data: `name`, `storage_path`, `mime_type`, `summary`, `status`, `processing_status`, `created_by_agent`, `version`, `is_canonical`, `parent_artifact_id`, `replaces_artifact_id`, `lineage_id`. A derivation parent creates a new artifact lineage; an explicit replacement shares the previous version’s lineage and increments its version.

Payment data: `amount_cents`, `currency`, `category`, `description`, `request_id`, `status`, approval flag, Checkout/payment IDs and timestamps. Amounts are USD integer cents.

## Writes

`write_update` accepts an array of operations and an expected **scope revision**. Project writes increment the project revision; personal writes increment the demo user's revision. The writer takes a per-scope transaction lock before checking revision or applying changes.

Operations:

```json
[
  {
    "op": "add_context",
    "kind": "knowledge",
    "content": "A supported finding",
    "confidence": 0.9
  },
  {
    "op": "supersede_context",
    "id": "existing-item-uuid",
    "kind": "decision",
    "content": "The explicitly revised decision"
  },
  { "op": "archive_context", "id": "existing-item-uuid" },
  { "op": "create_task", "title": "Draft memo", "status": "pending" },
  { "op": "update_task", "id": "existing-task-uuid", "status": "completed" },
  { "op": "resolve_question", "id": "existing-question-uuid" }
]
```

Exact normalized duplicates are ignored. An operation carrying `conflict_reason` is persisted as a review proposal instead of changing canonical context. Request IDs deduplicate retries; clients must not reuse an ID for a different logical request. Stale revisions return 409 without partially applying state.

The application blocks permission changes from agent calls, checks target scope, and commits activity with the state. Human edits create replacement versions. Models never write ledger totals.

## Ingestion

Conversation output is limited to 60,000 characters. Claude receives current active context and tasks and returns schema-validated operations. Processing attempts and failures are recorded. State commits precede indexing, so embedding failure cannot erase an accepted update.

`commit_work` is the standard silent agent write-back path. The agent answers the user normally and does not narrate context or persistence calls. The server records the original output as provenance, optionally saves a canonical Markdown artifact only for a requested or clearly reusable deliverable, extracts durable state, and records a dedicated activity event. A retry with the same request and content resumes a failed run or returns its prior result; reuse with different content is rejected. Saved artifacts and provenance survive extraction or indexing failures. Empty extraction results do not change project state. Contradictions remain review proposals.

Uploads are direct to a signed Supabase upload URL, keeping file bytes out of the Vercel API upload body. The original is downloaded server-side for validation/parsing. PDFs are checked for the 20-page limit. Gemini passages retain page or section locators and are split into bounded chunks. Claude's extracted state links to an artifact source record.

Supported parsing: PDF, PNG, JPEG, Markdown, and plain text. Other formats are preserved without automatic interpretation. Failed work is visible and retryable; an abandoned in-progress artifact can be reclaimed after five minutes.

## Retrieval

1. Resolve explicit scope; omission means personal-only context.
2. SQL fetches goal/status, active project decisions/constraints, incomplete tasks, canonical artifacts, applicable permissions, and financial ledger state.
3. Embed task with Gemini. Retrieve 20 project items, 10 personal items, 12 artifact chunks. Queries filter owner, project, and active state before ranking by cosine distance.
4. Claude selects candidate IDs relevant to the task. The application rejects invented or out-of-scope references.
5. Build a context pack from original records and protected structured state. Trim optional passages and knowledge toward an approximate 4,000-token target. Preserve required state even when over target and return a warning.
6. Store the exact pack and retrieval metadata for inspection.

This release uses selection and excerpt trimming rather than unconstrained model rewriting. It prevents a model from changing amounts or decision text while compiling context. Personal preferences are selected for relevance; permissions are always preserved.

On retrieval-provider failure, return `structured_only` with explicit warnings. Do not pretend semantic retrieval ran. Artifacts return expiring URLs and source-linked passages when available.

Pack fields: `project`, `personal_context`, `constraints`, `permissions`, `knowledge`, `decisions`, `open_questions`, `project_preferences`, `tasks`, `artifacts`, optional `budget`, and `meta`.

## MCP

Nine public tools: `list_projects`, `get_project_state`, `get_context`, `commit_work`, `ingest_output`, `write_update`, `save_artifact`, `search_artifacts`, `request_payment`. `commit_work` is the normal end-of-work path; the three lower-level write tools remain for advanced and recovery use.

The MCP SDK serves stateless Streamable HTTP POST. Each tool delegates to `lib/service.ts`, the same dispatcher used by UI actions. The UI-only surface includes human editing, project creation, signed uploads, spending rules, and Checkout approval. Tool errors are returned as `isError` responses.

MCP instructions require agents to resolve a project, retrieve task-specific context, perform the work, and call `commit_work` exactly once when the result contains meaningful durable information. MCP cannot intercept client responses, so this automation depends on the connected agent following the server instructions.

## Payments

Reservations are created under the project transaction lock after checking available budget. Requested reviews expire after 30 minutes and are released on the next payment request. Once Checkout exists, only verified payment/expiration events release or settle that reservation.

A human approves a review before the server creates a card-only test Checkout Session. The Stripe idempotency key is derived from the transaction ID. Signed webhook events verify project, amount, currency, and Checkout identity. Successful payments cannot regress on later failure/expiration events. Booking task completion and ledger updates commit atomically.

The app is intentionally unauthenticated and public for synthetic data only. It does not provide production user identity, approval authentication, refunds, tax accounting, or real reservations.

### Protected Link wallet boundary

Two additional MCP tools (`request_wallet_payment`, `get_wallet_payment`) require operator bearer authorization. Separate `/api/wallet` routes handle operator sessions, OAuth, refresh, cancellation, and a bearer-only credential handoff. Encrypted OAuth tokens live outside the public entity tables. Wallet transactions use the existing budget ledger with reserved states for pending, approved, and submitted purchases. See [Link Wallet](LINK-WALLET.md).
