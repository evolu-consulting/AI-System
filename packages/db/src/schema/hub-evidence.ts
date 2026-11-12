// CR-127 · E1 · kiểu Drizzle cho bằng chứng, nhận việc nhóm, uỷ quyền, phiếu "Cần: tất cả", tín hiệu đóng việc. CHỈ để truy vấn có kiểu:
// DDL, CHECK, FK kép tenant, RLS, GRANT, trigger bất biến và hàm SECURITY DEFINER (`record_evidence`, `evidence_get`, `task_signal`,
// `task_holder`) ở `migrations-hub/0131_cr127_evidence_claim_delegation.sql` (viết tay). `evidence` KHÔNG ghi trực tiếp bằng Drizzle:
// hub_rw chỉ SELECT — INSERT đi qua `hub.record_evidence` (kiểm tệp thuộc tenant, người ghi lấy từ `app.user_id`).
import { EVIDENCE_SUBJECT_KINDS, TASK_NEEDS } from "@ai/contracts/chat";
import { primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const DELEGATION_KIND_VALUES = ["approve", "form", "milestone", "esign"] as const;
export const VOTE_RESULT_VALUES = ["pass", "fail", "reject"] as const;
export const TASK_SIGNAL_KIND_VALUES = ["milestone"] as const;
export const TASK_SIGNAL_RESULT_VALUES = ["done", "cancelled"] as const;

/** Cột nhận việc của `hub.review_tasks` (spread ở `hub-processes.ts` — giữ file đó ≤ 400 dòng). */
export const reviewTaskClaimCols = () => ({
  need: text("need", { enum: TASK_NEEDS }).notNull().default("one"),
  claimedBy: uuid("claimed_by"),
  claimedAt: ts("claimed_at"),
  /** Quá mốc này mà người nhận chưa quyết ⇒ vòng nền trả về nhóm (E2). */
  claimDeadlineAt: ts("claim_deadline_at"),
  /** Đối tượng của việc (vd id mốc cho `kind = milestone`; bắt buộc khi kind đó — CHECK `review_tasks_milestone_ref_ck`). */
  subjectRef: text("subject_ref"),
});

/** Bằng chứng dùng chung — BẤT BIẾN (trigger `evidence_immutable`). */
export const evidence = hub.table("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subjectKind: text("subject_kind", { enum: EVIDENCE_SUBJECT_KINDS }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  note: text("note").notNull(),
  signatureAttachmentId: uuid("signature_attachment_id"),
  attachmentIds: uuid("attachment_ids").array().notNull().default([]),
  byUser: uuid("by_user").notNull(),
  /** Người được giao thật khi `byUser` làm thay (uỷ quyền). */
  onBehalfOf: uuid("on_behalf_of"),
  at: ts("at").notNull().defaultNow(),
});

/** Uỷ quyền A → B trong khoảng [from_at, to_at); huỷ = `revoked_at`. "Ai xem" lọc ở app (R#43). */
export const delegations = hub.table("delegations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  fromUserId: uuid("from_user_id").notNull(),
  toUserId: uuid("to_user_id").notNull(),
  fromAt: ts("from_at").notNull(),
  toAt: ts("to_at").notNull(),
  kinds: text("kinds", { enum: DELEGATION_KIND_VALUES }).array().notNull(),
  createdBy: uuid("created_by").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Phiếu của việc "Cần: tất cả": mỗi người một phiếu; `onBehalfOf` = người bỏ phiếu thay. */
export const reviewTaskVotes = hub.table(
  "review_task_votes",
  {
    taskId: uuid("task_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    onBehalfOf: uuid("on_behalf_of"),
    result: text("result", { enum: VOTE_RESULT_VALUES }).notNull(),
    evidenceId: uuid("evidence_id"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
);

/** Tín hiệu gói → engine: "việc của `subjectRef` xong/huỷ" (gói chỉ INSERT qua `hub.task_signal`; engine đóng task ở tx riêng). */
export const taskSignals = hub.table("task_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind", { enum: TASK_SIGNAL_KIND_VALUES }).notNull(),
  subjectRef: text("subject_ref").notNull(),
  result: text("result", { enum: TASK_SIGNAL_RESULT_VALUES }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
});

/** Kết quả `hub.task_holder` (đọc không khoá): người đã nhận + mọi người được giao của việc MỞ theo `subject_ref`. */
export type TaskHolderRow = {
  task_id: string;
  claimed_by: string | null;
  assignee_ids: string[];
};
