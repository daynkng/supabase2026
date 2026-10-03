import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budget,
  transitionPayment,
  validateOperation,
  deltaSchema,
  normalize,
  NAPA,
} from "../lib/domain";
import { seed } from "../lib/seed";
test("Napa ledger calculates $472 spent and $328 remaining", () => {
  const p = seed().projects.find((p) => p.id === NAPA)!;
  const tx = [41000, 6200].map((n, i) => ({
    ...p,
    id: String(i),
    data: { amount_cents: n, status: "succeeded" },
  }));
  const b = budget(p, tx);
  assert.equal(b.spent_cents, 47200);
  assert.equal(b.remaining_cents, 32800);
  assert.equal(b.available_cents, 32800);
});
test("pending reservations reduce available but not remaining; failures do not count", () => {
  const p = seed().projects[1];
  const tx = [
    { ...p, data: { amount_cents: 41000, status: "checkout" } },
    { ...p, data: { amount_cents: 6200, status: "failed" } },
  ];
  const b = budget(p, tx);
  assert.equal(b.spent_cents, 0);
  assert.equal(b.remaining_cents, 80000);
  assert.equal(b.available_cents, 39000);
});
test("successful payments never regress on late failure or expiration", () => {
  assert.equal(transitionPayment("succeeded", "failed"), "succeeded");
  assert.equal(transitionPayment("succeeded", "expired"), "succeeded");
  assert.equal(transitionPayment("expired", "succeeded"), "succeeded");
});
test("agents cannot create permission rules", () => {
  const [op] = deltaSchema.parse([
    { op: "add_context", kind: "permission", content: "Spend freely" },
  ]);
  assert.throws(() => validateOperation(op, false), /human/);
});
test("updates require an existing target and additions require content", () => {
  const [op] = deltaSchema.parse([
    { op: "supersede_context", kind: "decision", content: "Updated" },
  ]);
  assert.throws(() => validateOperation(op, false), /ID/);
  assert.throws(
    () =>
      deltaSchema.parse([{ op: "add_context", content: "x", confidence: 2 }]),
    /number/,
  );
});
test("unknown mutation keys rejected", () => {
  assert.throws(
    () =>
      deltaSchema.parse([
        { op: "add_context", kind: "knowledge", content: "x", budget_spent: 0 },
      ]),
    /Unrecognized/,
  );
});
test("normalization handles repeated whitespace and case", () =>
  assert.equal(normalize("  Boutique   HOTEL "), "boutique hotel"));
