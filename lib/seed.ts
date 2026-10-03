import { OWNER, WORK, NAPA, Row } from "./domain";
const stamp = "2026-10-03T12:00:00.000Z";
let n = 100;
const row = (
  project_id: string | null,
  data: Record<string, any>,
  id?: string,
): Row => ({
  id: id ?? `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`,
  user_id: OWNER,
  project_id,
  data,
  revision: 0,
  created_at: stamp,
  updated_at: stamp,
});
export function seed() {
  n = 100;
  const source = row(null, {
    source_type: "synthetic_fixture",
    source_agent: "Seed",
    excerpt: "Synthetic demonstration preferences and goals.",
  });
  return {
    users: [row(null, { name: "Demo workspace" }, OWNER)],
    projects: [
      row(
        null,
        {
          name: "AI Agent Market Research",
          type: "work",
          goal: "Research the AI agent market and prepare an executive presentation.",
          status: "active",
        },
        WORK,
      ),
      row(
        null,
        {
          name: "Napa Weekend",
          type: "personal",
          goal: "Plan and book a winery-focused Napa weekend under $800.",
          status: "active",
          budget_total_cents: 80000,
          approval_threshold_cents: 20000,
        },
        NAPA,
      ),
    ],
    sources: [source],
    context_items: [
      ...(
        [
          ["working_style", "Prefers concise executive summaries"],
          ["preference", "Prefers boutique hotels"],
          ["constraint", "Vegetarian dining"],
          ["constraint", "No travel or activities before 9 AM"],
          ["permission", "Purchases above $200 require human approval"],
        ] as const
      ).map(([kind, content]) =>
        row(null, {
          kind,
          content,
          status: "active",
          confidence: 1,
          source_id: source.id,
          source_agent: "Seed",
          scope: "personal",
          ...(kind === "permission" ? { approval_threshold_cents: 20000 } : {}),
        }),
      ),
      row(WORK, {
        kind: "constraint",
        content:
          "Support market claims with sources and distinguish evidence from hypotheses.",
        status: "active",
        confidence: 1,
        source_id: source.id,
        source_agent: "Seed",
        scope: "project",
      }),
      row(NAPA, {
        kind: "preference",
        content: "Winery-focused trip with a boutique hotel.",
        status: "active",
        confidence: 1,
        source_id: source.id,
        source_agent: "Seed",
        scope: "project",
      }),
    ],
    tasks: [
      ...["Research", "Analysis", "Memo", "Deck"].map((title) =>
        row(WORK, {
          title,
          description: "",
          status: "pending",
          created_by: "Seed",
        }),
      ),
      ...["Hotel", "Winery", "Dinner", "Itinerary"].map((title) =>
        row(NAPA, {
          title,
          ...(["Hotel", "Winery"].includes(title)
            ? { payment_category: title }
            : {}),
          description: "",
          status: "pending",
          created_by: "Seed",
        }),
      ),
    ],
    artifacts: [],
    artifact_chunks: [],
    activities: [
      row(WORK, {
        actor: "Seed",
        action_type: "seed",
        description:
          "Synthetic research project created. No research has been performed yet.",
      }),
      row(NAPA, {
        actor: "Seed",
        action_type: "seed",
        description:
          "Synthetic Napa project created. No bookings or payments have been made.",
      }),
    ],
    ingestion_runs: [],
    context_retrievals: [],
    transactions: [],
    processed_stripe_events: [],
  };
}
