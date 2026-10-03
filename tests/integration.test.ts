import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { db, rows, get, insert, transaction, useTestPool } from "../lib/db";
import { testPool } from "./pglite-pool";
import { seed } from "../lib/seed";
import { OWNER, WORK, NAPA, budget } from "../lib/domain";
import { writeUpdate, ingestOutput } from "../lib/state";
import { contextPack, semantic } from "../lib/retrieval";
import { requestPayment, processStripeEvent } from "../lib/payments";
import { POST as webhook } from "../app/api/stripe/webhook/route";
import { commitWork } from "../lib/commit-work";
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL = "embedded-test-only";
process.env.STRIPE_SECRET_KEY = "sk_test_integration_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration_fixture";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
before(async () => {
  useTestPool(await testPool());
  await db().query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint)",
  );
  for (const migration of ["001_initial.sql", "002_link_wallet.sql"])
    await db().query(
      await readFile(`supabase/migrations/${migration}`, "utf8"),
    );
  for (const [t, rs] of Object.entries(seed()))
    for (const r of rs)
      await db().query(
        `INSERT INTO ${t}(id,user_id,project_id,data) VALUES($1,$2,$3,$4)`,
        [r.id, OWNER, r.project_id, JSON.stringify(r.data)],
      );
});
after(async () => {
  await db().end();
});
test("write idempotency, stale revision, cross-project protection, correction history", async () => {
  const input = {
    project_id: WORK,
    request_id: "write-1",
    expected_revision: 0,
    source_agent: "Claude",
    state_delta: [
      {
        op: "add_context",
        kind: "decision",
        content: "Focus on enterprise work agents",
        confidence: 1,
      },
    ],
  };
  const first = await writeUpdate(input);
  assert.equal(first.accepted.length, 1);
  assert.deepEqual(await writeUpdate(input), first);
  await assert.rejects(
    writeUpdate({ ...input, request_id: "stale" }),
    /Revision conflict/,
  );
  const item = (await rows("context_items", WORK)).find(
    (r) => r.data.kind === "decision",
  )!;
  await assert.rejects(
    writeUpdate({
      project_id: NAPA,
      request_id: "scope",
      expected_revision: 0,
      state_delta: [{ op: "archive_context", id: item.id }],
    }),
    /Scope mismatch/,
  );
  await writeUpdate(
    {
      project_id: WORK,
      request_id: "correct",
      expected_revision: 1,
      state_delta: [
        {
          op: "supersede_context",
          id: item.id,
          kind: "decision",
          content: "Focus on personal assistants",
        },
      ],
    },
    true,
  );
  assert.equal((await get("context_items", item.id)).data.status, "superseded");
  const pack = await contextPack("Write a deck", WORK);
  assert.equal(pack.meta.retrieval_mode, "structured_only");
  assert.equal(pack.decisions.length, 1);
  assert.equal(pack.decisions[0].content, "Focus on personal assistants");
  assert.equal(pack.personal_context.length, 0);
  assert(!JSON.stringify(pack).includes("Winery-focused"));
});
test("duplicate normalized content is ignored", async () => {
  const p = await get("projects", WORK);
  const r = await writeUpdate({
    project_id: WORK,
    expected_revision: p.revision,
    request_id: "duplicate-content",
    state_delta: [
      {
        op: "add_context",
        kind: "decision",
        content: "  Focus on PERSONAL assistants  ",
      },
    ],
  });
  assert.equal(r.accepted[0].operation, "ignored_duplicate");
});
test("permission changes are blocked even when targeting an existing permission", async () => {
  const p = (await rows("context_items", null)).find(
    (r) => r.data.kind === "permission",
  )!;
  await assert.rejects(
    writeUpdate({
      project_id: null,
      request_id: "permission-attack",
      expected_revision: 0,
      state_delta: [{ op: "archive_context", id: p.id }],
    }),
    /human/,
  );
});
test("personal retrieval excludes project records and persists exact pack", async () => {
  const pack = await contextPack("Write a concise summary");
  assert.equal(pack.project, null);
  assert.deepEqual(pack.decisions, []);
  assert.deepEqual(pack.tasks, []);
  assert.equal(pack.permissions.length, 1);
  const records = await rows("context_retrievals", null);
  assert.deepEqual(records[0].data.pack, pack);
});
test("provider ingestion failure is recorded without invented state", async () => {
  const before = (await rows("context_items", WORK)).length;
  await assert.rejects(
    ingestOutput(WORK, "Research complete", "Claude", "failure"),
    /Anthropic/,
  );
  assert.equal((await rows("context_items", WORK)).length, before);
  assert(
    (await rows("activities", WORK)).some(
      (r) => r.data.action_type === "error",
    ),
  );
});
test("concurrent reservations cannot overspend; duplicate request is idempotent", async () => {
  const r = await Promise.allSettled([
    requestPayment(NAPA, 50000, "Hotel", "Concurrent A", "reserve-a"),
    requestPayment(NAPA, 50000, "Hotel", "Concurrent B", "reserve-b"),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const fulfilled = r.find(
    (x) => x.status === "fulfilled",
  ) as PromiseFulfilledResult<any>;
  const t = fulfilled.value.transaction;
  const retry = await requestPayment(
    NAPA,
    50000,
    "Hotel",
    t.data.description,
    t.data.request_id,
  );
  assert.equal(retry.transaction.id, t.id);
  await db().query("DELETE FROM transactions WHERE project_id=$1", [NAPA]);
});
function event(
  t: any,
  type: string,
  id: string,
  paid = true,
  amount?: number,
): any {
  return {
    id,
    type,
    livemode: false,
    data: {
      object: {
        id: `cs_test_${t.id}`,
        metadata: { transaction_id: t.id, project_id: NAPA },
        currency: "usd",
        amount_total: amount ?? t.data.amount_cents,
        payment_status: paid ? "paid" : "unpaid",
        payment_intent: `pi_test_${t.id}`,
      },
    },
  };
}
test("verified ledger updates exact demo totals and completes simulated tasks; late events do not regress", async () => {
  const hotel = (await requestPayment(NAPA, 41000, "Hotel", "Hotel", "hotel"))
    .transaction;
  const winery = (
    await requestPayment(NAPA, 6200, "Winery", "Winery", "winery")
  ).transaction;
  const success = event(hotel, "checkout.session.completed", "evt_hotel");
  await processStripeEvent(success);
  const paidAt = (await get("transactions", hotel.id)).data.paid_at;
  assert.deepEqual(await processStripeEvent(success), { duplicate: true });
  await processStripeEvent(
    event(hotel, "checkout.session.expired", "evt_late", false),
  );
  assert.equal((await get("transactions", hotel.id)).data.paid_at, paidAt);
  await processStripeEvent(
    event(winery, "checkout.session.completed", "evt_winery"),
  );
  const b = budget(
    await get("projects", NAPA),
    await rows("transactions", NAPA),
  );
  assert.equal(b.spent_cents, 47200);
  assert.equal(b.remaining_cents, 32800);
  assert.equal(b.reserved_cents, 0);
  assert.equal(
    (await rows("tasks", NAPA)).filter((t) => t.data.status === "completed")
      .length,
    2,
  );
  await assert.rejects(
    processStripeEvent(
      event(winery, "checkout.session.completed", "evt_bad", true, 1),
    ),
    /amount/,
  );
});
test("failed checkout releases reservation and does not count as spending", async () => {
  const dinner = (
    await requestPayment(NAPA, 10000, "Dinner", "Dinner", "dinner")
  ).transaction;
  await processStripeEvent(
    event(dinner, "checkout.session.async_payment_failed", "evt_failed", false),
  );
  const b = budget(
    await get("projects", NAPA),
    await rows("transactions", NAPA),
  );
  assert.equal(b.spent_cents, 47200);
  assert.equal(b.available_cents, 32800);
});
test("forged webhook signature is rejected", async () => {
  const r = await webhook(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "bad" },
      body: "{}",
    }),
  );
  assert.equal(r.status, 400);
});

test("pgvector retrieval excludes other projects and superseded items; chunks preserve pages", async () => {
  const vector = Array(768).fill(0);
  vector[0] = 1;
  const current = (await rows("context_items", WORK)).find(
    (r) => r.data.status === "active",
  )!;
  await db().query(
    "UPDATE context_items SET embedding=$1::vector WHERE user_id=$2",
    [JSON.stringify(vector), OWNER],
  );
  const found = await semantic("context_items", WORK, vector, 20);
  assert(found.length > 0);
  assert(
    found.every((r) => r.project_id === WORK && r.data.status === "active"),
  );
  const artifactId = crypto.randomUUID();
  const chunkId = crypto.randomUUID();
  await db().query(
    "INSERT INTO artifacts(id,user_id,project_id,data) VALUES($1,$2,$3,$4)",
    [
      artifactId,
      OWNER,
      WORK,
      JSON.stringify({ status: "active", name: "evidence.pdf" }),
    ],
  );
  await db().query(
    "INSERT INTO artifact_chunks(id,user_id,project_id,data,embedding) VALUES($1,$2,$3,$4,$5::vector)",
    [
      chunkId,
      OWNER,
      WORK,
      JSON.stringify({
        artifact_id: artifactId,
        locator: "page 7",
        text: "Evidence passage",
      }),
      JSON.stringify(vector),
    ],
  );
  const chunks = await semantic("artifact_chunks", WORK, vector, 12);
  assert.equal(chunks[0].data.locator, "page 7");
  assert.equal((await semantic("artifact_chunks", NAPA, vector, 12)).length, 0);
  await db().query(
    'UPDATE artifacts SET data=data || \'{"status":"archived"}\' WHERE id=$1',
    [artifactId],
  );
  assert.equal((await semantic("artifact_chunks", WORK, vector, 12)).length, 0);
});

test("MCP protocol initializes, lists tools, and executes an actual shared-state read", async () => {
  process.env.DEMO_PUBLIC = "true";
  const { POST } = await import("../app/mcp/route");
  const call = async (body: any) => {
    const response = await POST(
      new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const initialized = await call({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "1.0" },
    },
  });
  assert.equal(initialized.result.serverInfo.name, "Shared State");
  const list = await call({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  assert.equal(list.result.tools.length, 11);
  assert(list.result.tools.some((tool: any) => tool.name === "commit_work"));
  const result = await call({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_projects", arguments: {} },
  });
  assert.equal(result.result.isError, undefined);
  assert.equal(JSON.parse(result.result.content[0].text).length, 2);
});

test("request ID reuse with different mutations is rejected", async () => {
  await assert.rejects(
    writeUpdate({
      project_id: WORK,
      request_id: "write-1",
      expected_revision: 0,
      state_delta: [
        { op: "add_context", kind: "knowledge", content: "Different request" },
      ],
    }),
    /different changes/,
  );
});

test("superseding with existing content retires the old decision without duplication", async () => {
  const p = await get("projects", WORK);
  const created = await writeUpdate({
    project_id: WORK,
    request_id: "alternate-decision",
    expected_revision: p.revision,
    state_delta: [
      { op: "add_context", kind: "decision", content: "Alternative direction" },
    ],
  });
  const prior = created.accepted[0].id;
  const result = await writeUpdate({
    project_id: WORK,
    request_id: "converge-decision",
    expected_revision: created.revision,
    state_delta: [
      {
        op: "supersede_context",
        id: prior,
        kind: "decision",
        content: "Focus on personal assistants",
      },
    ],
  });
  assert.equal(result.accepted[0].operation, "supersede_context");
  assert.equal((await get("context_items", prior)).data.status, "superseded");
  assert.equal(
    (await rows("context_items", WORK)).filter(
      (r) => r.data.kind === "decision" && r.data.status === "active",
    ).length,
    1,
  );
});

test("booking completion cannot bypass payment verification", async () => {
  const p = await get("projects", NAPA);
  const task = (await rows("tasks", NAPA)).find(
    (t) => t.data.title === "Hotel",
  )!;
  await db().query(
    'UPDATE transactions SET data=data || \'{"status":"failed"}\' WHERE project_id=$1',
    [NAPA],
  );
  await assert.rejects(
    writeUpdate({
      project_id: NAPA,
      request_id: "fake-booking",
      expected_revision: p.revision,
      state_delta: [{ op: "update_task", id: task.id, status: "completed" }],
    }),
    /verified successful/,
  );
});

test("ambiguous state stays out of canonical context until human review", async () => {
  const { execute } = await import("../lib/service");
  const p = await get("projects", WORK);
  await writeUpdate({
    project_id: WORK,
    request_id: "ambiguous",
    expected_revision: p.revision,
    state_delta: [
      {
        op: "add_context",
        kind: "knowledge",
        content: "Human-reviewed finding",
        conflict_reason: "Source contradicts prior evidence",
      },
    ],
  });
  assert(
    !(await rows("context_items", WORK)).some(
      (r) => r.data.content === "Human-reviewed finding",
    ),
  );
  const run = (await rows("ingestion_runs", WORK)).find(
    (r) => r.data.request_id === "ambiguous",
  )!;
  await assert.rejects(
    execute(
      "resolve_review",
      {
        id: run.id,
        index: 0,
        resolution: "apply",
        expected_revision: p.revision + 1,
      },
      false,
    ),
    /Human UI/,
  );
  await execute(
    "resolve_review",
    {
      id: run.id,
      index: 0,
      resolution: "apply",
      expected_revision: p.revision + 1,
    },
    true,
  );
  assert(
    (await rows("context_items", WORK)).some(
      (r) => r.data.content === "Human-reviewed finding",
    ),
  );
  assert.equal((await get("ingestion_runs", run.id)).data.stage, "complete");
});

test("commit_work saves a deliverable, applies durable state, and is idempotent", async () => {
  let saves = 0;
  let extractions = 0;
  const research = (await rows("tasks", WORK)).find(
    (task) => task.data.title === "Research",
  )!;
  const dependencies = {
    saveDeliverable: async (
      project: string,
      name: string,
      text: string,
      agent: string,
    ) => {
      saves++;
      return insert("artifacts", project, {
        name,
        text_content: text,
        summary: text,
        status: "active",
        processing_status: "stored",
        created_by_agent: agent,
        is_canonical: true,
        version: 1,
        lineage_id: crypto.randomUUID(),
      });
    },
    extractOperations: async () => {
      extractions++;
      return [
        {
          op: "add_context",
          kind: "knowledge",
          content: "Agent handoffs reduce repeated project briefing.",
          confidence: 1,
        },
        {
          op: "update_task",
          id: research.id,
          status: "completed",
          confidence: 1,
        },
      ] as any;
    },
    index: async () => ({ indexed: 1, pending: 0 }),
  };
  const input = {
    project_id: WORK,
    request_id: "commit-meaningful",
    output_text:
      "Research found that agent handoffs reduce repeated project briefing. Research is complete.",
    deliverable: { name: "research-summary.md", text: "# Research summary" },
  };
  const first = await commitWork(input, "ChatGPT", dependencies as any);
  assert.equal(first.accepted.length, 2);
  assert.equal(first.artifact.data.name, "research-summary.md");
  assert.equal(first.review.length, 0);
  const retried = await commitWork(input, "ChatGPT", dependencies as any);
  assert.deepEqual(retried, JSON.parse(JSON.stringify(first)));
  assert.equal(saves, 1);
  assert.equal(extractions, 1);
  await assert.rejects(
    commitWork(
      { ...input, output_text: "Different work under the same request ID" },
      "ChatGPT",
      dependencies as any,
    ),
    /different work/,
  );
  const pack = await contextPack(
    "Continue the research from ChatGPT's findings",
    WORK,
    "Claude",
  );
  assert(
    pack.knowledge.some(
      (item: any) =>
        item.content === "Agent handoffs reduce repeated project briefing.",
    ),
  );
  assert(
    (await rows("activities", WORK)).some(
      (row) =>
        row.data.action_type === "commit_work" &&
        row.data.artifact_id === first.artifact.id,
    ),
  );
});

test("commit_work ignores casual output and queues contradictions for review", async () => {
  const sourceCount = (await rows("sources", WORK)).length;
  const activityCount = (await rows("activities", WORK)).length;
  const noop = await commitWork(
    {
      project_id: WORK,
      request_id: "commit-casual",
      output_text: "Thanks, understood.",
    },
    "Claude",
    {
      saveDeliverable: async () => {
        throw new Error("No deliverable expected");
      },
      extractOperations: async () => [],
      index: async () => ({ indexed: 0, pending: 0 }),
    } as any,
  );
  assert.deepEqual(noop.accepted, []);
  assert.deepEqual(noop.review, []);
  assert.equal(noop.ignored, true);
  assert.equal((await rows("sources", WORK)).length, sourceCount);
  assert.equal((await rows("activities", WORK)).length, activityCount);
  const ignoredRun = (await rows("ingestion_runs", WORK)).find(
    (row) => row.data.request_id === "commit-casual",
  )!;
  assert.equal(ignoredRun.data.output_text, null);
  assert.equal(ignoredRun.data.source_id, null);

  const conflicted = await commitWork(
    {
      project_id: WORK,
      request_id: "commit-conflict",
      output_text: "A new source contradicts the active market direction.",
    },
    "Claude",
    {
      saveDeliverable: async () => {
        throw new Error("No deliverable expected");
      },
      extractOperations: async () =>
        [
          {
            op: "add_context",
            kind: "decision",
            content: "Reverse the active market direction",
            confidence: 0.5,
            conflict_reason: "Contradicts the active decision",
          },
        ] as any,
      index: async () => ({ indexed: 0, pending: 0 }),
    } as any,
  );
  assert.equal(conflicted.accepted.length, 0);
  assert.equal(conflicted.review.length, 1);
  assert(
    !(await rows("context_items", WORK)).some(
      (row) => row.data.content === "Reverse the active market direction",
    ),
  );
});

test("commit_work preserves provenance and a saved artifact when extraction fails", async () => {
  let savedArtifact: any;
  const input = {
    project_id: WORK,
    request_id: "commit-retry",
    output_text: "Final memo with durable conclusions.",
    deliverable: { name: "retry-memo.md", text: "# Durable memo" },
  };
  const saveDeliverable = async (
    project: string,
    name: string,
    text: string,
    agent: string,
  ) => {
    savedArtifact ??= await insert("artifacts", project, {
      name,
      text_content: text,
      status: "active",
      processing_status: "stored",
      created_by_agent: agent,
      is_canonical: true,
      version: 1,
      lineage_id: crypto.randomUUID(),
    });
    return savedArtifact;
  };
  await assert.rejects(
    commitWork(input, "ChatGPT", {
      saveDeliverable,
      extractOperations: async () => {
        throw new Error("Extraction unavailable");
      },
      index: async () => ({ indexed: 0, pending: 0 }),
    } as any),
    /Extraction unavailable/,
  );
  const failed = (await rows("ingestion_runs", WORK)).find(
    (row) => row.data.request_id === input.request_id,
  )!;
  assert.equal(failed.data.stage, "artifact_saved_needs_retry");
  assert.equal(failed.data.artifact_id, savedArtifact.id);
  const source = await get("sources", failed.data.source_id);
  assert.equal(source.data.excerpt, input.output_text);

  const recovered = await commitWork(input, "ChatGPT", {
    saveDeliverable,
    extractOperations: async () => [],
    index: async () => ({ indexed: 0, pending: 0 }),
  } as any);
  assert.equal(recovered.artifact.id, savedArtifact.id);
});

test("commit_work cannot change permissions or bypass payment completion", async () => {
  const blockedDependencies = (operations: any[]) =>
    ({
      saveDeliverable: async () => {
        throw new Error("No deliverable expected");
      },
      extractOperations: async () => operations,
      index: async () => ({ indexed: 0, pending: 0 }),
    }) as any;
  await assert.rejects(
    commitWork(
      {
        project_id: WORK,
        request_id: "commit-permission-attack",
        output_text: "Remove the approval rule.",
      },
      "ChatGPT",
      blockedDependencies([
        {
          op: "add_context",
          kind: "permission",
          content: "No approval required",
          confidence: 1,
        },
      ]),
    ),
    /human control center/,
  );
  const hotel = (await rows("tasks", NAPA)).find(
    (task) => task.data.title === "Hotel",
  )!;
  await assert.rejects(
    commitWork(
      {
        project_id: NAPA,
        request_id: "commit-payment-attack",
        output_text: "The hotel is booked and complete.",
      },
      "Claude",
      blockedDependencies([
        {
          op: "update_task",
          id: hotel.id,
          status: "completed",
          confidence: 1,
        },
      ]),
    ),
    /verified successful/,
  );
});
