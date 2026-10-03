import { z } from "zod";
export const OWNER = "00000000-0000-4000-8000-000000000001";
export const WORK = "00000000-0000-4000-8000-000000000010";
export const NAPA = "00000000-0000-4000-8000-000000000020";
export const kinds = [
  "knowledge",
  "decision",
  "preference",
  "constraint",
  "working_style",
  "background",
  "permission",
  "open_question",
] as const;
export const kindSchema = z.preprocess(
  (value) =>
    value === "finding" || value === "research_finding"
      ? "knowledge"
      : value,
  z.enum(kinds),
);
export type Row = {
  id: string;
  project_id: string | null;
  user_id: string;
  data: Record<string, any>;
  created_at: string;
  updated_at: string;
  revision: number;
};
export const operationSchema = z
  .object({
    op: z.enum([
      "add_context",
      "supersede_context",
      "archive_context",
      "create_task",
      "update_task",
      "resolve_question",
    ]),
    id: z.string().uuid().optional(),
    kind: kindSchema.optional(),
    content: z.string().min(1).max(12000).optional(),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(["pending", "in_progress", "completed"]).optional(),
    confidence: z.number().min(0).max(1).default(1),
    conflict_reason: z.string().max(1000).optional(),
  })
  .strict();
export const deltaSchema = z.array(operationSchema).max(50);
export type Operation = z.infer<typeof operationSchema>;
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
export function budget(project: Row, tx: Row[]) {
  const paid = tx
    .filter((t) => t.data.status === "succeeded")
    .reduce((n, t) => n + t.data.amount_cents, 0);
  const reserved = tx
    .filter((t) =>
      [
        "requested",
        "checkout",
        "wallet_pending",
        "wallet_approved",
        "wallet_submitted",
      ].includes(t.data.status),
    )
    .reduce((n, t) => n + t.data.amount_cents, 0);
  const total = project.data.budget_total_cents;
  return {
    currency: "USD",
    total_cents: total,
    spent_cents: paid,
    reserved_cents: reserved,
    remaining_cents: total - paid,
    available_cents: total - paid - reserved,
    approval_threshold_cents: project.data.approval_threshold_cents ?? 20000,
  };
}
export function transitionPayment(current: string, next: string) {
  return current === "succeeded"
    ? "succeeded"
    : next === "succeeded"
      ? "succeeded"
      : ["failed", "expired"].includes(current)
        ? current
        : next;
}
export function validateOperation(op: Operation, human: boolean) {
  if (op.kind === "permission" && !human)
    throw new AppError(
      "Permission changes require the human control center",
      403,
    );
  if (
    [
      "supersede_context",
      "archive_context",
      "update_task",
      "resolve_question",
    ].includes(op.op) &&
    !op.id
  )
    throw new AppError("Existing item ID is required");
  if (
    ["add_context", "supersede_context"].includes(op.op) &&
    (!op.content || !op.kind)
  )
    throw new AppError("Context content and kind are required");
  if (op.op === "create_task" && !op.title)
    throw new AppError("Task title is required");
}
export function active(r: Row) {
  return r.data.status === "active";
}
export function ref(r: Row) {
  return {
    id: r.id,
    content: r.data.content,
    source_id: r.data.source_id,
    confidence: r.data.confidence ?? 1,
  };
}
