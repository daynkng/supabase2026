# Live demonstration scripts

Use an initialized deployment and fresh synthetic seeds. These are prompts for real clients, not claims that actions have already occurred.

## Work flow

### Claude — research

> Find the AI Agent Market Research project with list_projects and call get_context before working. Research the market for general-purpose AI work agents using available source tools. Clearly distinguish sourced findings from hypotheses. After completing meaningful work, call commit_work exactly once with your final output. Do not mark analysis, memo, or deck complete unless you actually finish them.

Verify Context and Activity show real accepted changes and provenance.

### User — artifact evidence

Upload a short competitor PDF through Artifacts. Wait for complete processing. Inspect extracted passages and page locators. If a provider fails, resolve the visible error and retry; do not skip past it as a success.

### ChatGPT — investment memo

> Find AI Agent Market Research and use get_context for “Create an investment memo from our existing research.” Use the prior findings and sources without asking me to repeat them. If evidence is insufficient, say what is missing. After finishing, call commit_work exactly once with your final output and a deliverable named market-memo.md. Keep unresolved questions open.

Verify the memo is downloadable and canonical, and inspect the exact context pack.

### Claude — deck

> Continue AI Agent Market Research. Read context for a six-slide executive deck using the canonical memo and supporting research. Create six slides of content, then call commit_work exactly once with the final output and deck-v1.md as the deliverable, using the memo as parent_artifact_id. Do not invent unsupported claims.

Verify artifact lineage, task completion, and shared activity.

## Napa flow

### Claude — hotel request

> Find Napa Weekend and read context for planning the trip. Respect the user’s dietary, timing, and hotel preferences. Request a $410 Hotel Stripe test payment for “Boutique hotel — simulated Napa booking.” Return the human review URL. This is a synthetic demo; do not claim a real reservation or successful payment.

Open the review page, approve, and use Stripe's test card. Wait for verified confirmation. Hotel becomes complete, spent is $410, remaining is $390.

### ChatGPT — winery request

> Continue Napa Weekend. Read the current shared context and budget. Request a $62 Winery test payment for “Winery visit — simulated Napa booking.” Return the review link. Do not charge directly or report completion before confirmation.

Complete test Checkout. Verify $472 spent, $328 remaining, and Hotel/Winery completed.

### Claude — dinner adjustment

> Continue Napa Weekend without re-briefing. Read current context, keep dinner vegetarian, move the planned dinner to 8 PM, and remain within the current available budget. After producing the revised plan, call commit_work exactly once with the final output. Do not mark dinner booked or paid unless verified.

Verify the updated decision is visible in both clients and the control center.

## Human correction

Edit a project decision in Context. Enable Show history and confirm the original is superseded. Ask the other client to fetch a new pack and confirm it sees only the active replacement.

## Completion evidence

Capture the two real client tool calls, one parsed PDF with page references, downloaded memo/deck text, actual Stripe test event IDs, exact budget totals, and the Context Inspector contents. Configuration badges or fixture tests alone do not satisfy live demo acceptance.
