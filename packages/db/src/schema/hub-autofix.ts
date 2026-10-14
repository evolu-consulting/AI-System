// HUB-FR-128 · HUB-FR-130 · PC-R12 · kiểu Drizzle cho `hub.autofix_results` (spec P-c §4, plan §2).
// CHỈ để truy vấn có kiểu: DDL thật, CHECK (status/diff/round/sha/branch/json), FK `(process_run_id, tenant_id)` CASCADE,
// FK attachment SET NULL, index, RLS "T" và GRANT ở `migrations-hub/0031_pc_autofix.sql` (viết tay).
// BẪY: append-only — `hub_rw` chỉ SELECT/INSERT ⇒ KHÔNG `update()`/`delete()` (42501). Chiều "ok ⇒ có diff" kiểm ở service.
import {
  APPLY_ERROR_CODES,
  APPLY_MODES,
  APPLY_STATUSES,
  AUTOFIX_STATUSES,
  type AutofixDiffStats,
  type AutofixFailure,
  type SourcePin,
} from "@ai/contracts/hub-admin";
import type { AutofixReport } from "@ai/contracts/hub-internal";
import { boolean, integer, jsonb, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { hub } from "./hub-readonly";

/** Một nguồn với contract; đổi giá trị ⇒ migration mới sửa `autofix_results_status_ck`. */
export const AUTOFIX_STATUS_VALUES = AUTOFIX_STATUSES;
export type AutofixCommandRow = AutofixReport["commands"][number];

export const autofixResults = hub.table("autofix_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  processRunId: uuid("process_run_id").notNull(),
  stageRunId: uuid("stage_run_id").notNull(),
  /** UNIQUE — báo cáo lặp cùng job ⇒ 23505 (endpoint trả 409). */
  jobId: uuid("job_id").notNull(),
  round: smallint("round").notNull(),
  sourceKey: text("source_key").notNull(),
  pin: jsonb("pin").$type<SourcePin>().notNull(),
  /** `ai/<process_run_id>/<stage_key>` (CHECK `autofix_results_branch_ck`). */
  branch: text("branch").notNull(),
  baseSha: text("base_sha").notNull(),
  headSha: text("head_sha").notNull(),
  status: text("status", { enum: AUTOFIX_STATUS_VALUES }).notNull(),
  failures: jsonb("failures").$type<AutofixFailure[]>().notNull().default([]),
  diffStats: jsonb("diff_stats").$type<AutofixDiffStats>(),
  /** Chỉ khác null khi status='ok' (CHECK `autofix_results_diff_ck`); SET NULL khi xoá attachment. */
  diffAttachmentId: uuid("diff_attachment_id"),
  testLogAttachmentId: uuid("test_log_attachment_id"),
  testExitCode: integer("test_exit_code"),
  testDurationMs: integer("test_duration_ms"),
  commands: jsonb("commands").$type<AutofixCommandRow[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AutofixResultRow = typeof autofixResults.$inferSelect;
export type NewAutofixResult = typeof autofixResults.$inferInsert;

/** Giá trị enum đồng bộ CHECK migration 0032 (P-c2). Đổi ⇒ migration mới sửa CHECK tương ứng. */
export const APPLY_MODE_VALUES = APPLY_MODES;
export const APPLY_STATUS_VALUES = APPLY_STATUSES;
export const APPLY_ERROR_CODE_VALUES = APPLY_ERROR_CODES;

// HUB-FR-129 · PC2-R13 · P-c2 kết quả một lần Áp (spec §4, plan §2) — DDL thật + RLS "T" + GRANT theo cột ở
// `migrations-hub/0032_pc2_apply.sql`. BẪY: `hub_rw` chỉ UPDATE (status, provider, pr_number, pr_url, auto_merge,
// error_code, detail, updated_at) + SELECT/INSERT; UPDATE cột khác/DELETE ⇒ 42501. `job_id` UNIQUE nhưng NULL
// (no_changes/branch_only local) ⇒ không ràng buộc. Bất biến error_code (C11) + head/pr ở CHECK migration.
export const autofixApplies = hub.table("autofix_applies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  processRunId: uuid("process_run_id").notNull(),
  stageRunId: uuid("stage_run_id").notNull(),
  /** NULL khi không job (no_changes/branch_only local); UNIQUE ⇒ báo cáo lặp cùng job ⇒ 23505 (409). */
  jobId: uuid("job_id"),
  /** Kết quả tự-sửa được áp; SET NULL khi xoá. */
  autofixResultId: uuid("autofix_result_id"),
  sourceKey: text("source_key").notNull(),
  mode: text("mode", { enum: APPLY_MODE_VALUES }).notNull(),
  status: text("status", { enum: APPLY_STATUS_VALUES }).notNull(),
  branch: text("branch"),
  pinSha: text("pin_sha"),
  targetSha: text("target_sha"),
  headSha: text("head_sha"),
  rebased: boolean("rebased").notNull().default(false),
  provider: text("provider", { enum: ["github"] }),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  autoMerge: text("auto_merge", { enum: ["on", "failed"] }),
  errorCode: text("error_code", { enum: APPLY_ERROR_CODE_VALUES }),
  detail: text("detail"),
  conflictFiles: jsonb("conflict_files").$type<string[]>().notNull().default([]),
  failures: jsonb("failures").$type<AutofixFailure[]>().notNull().default([]),
  testExitCode: integer("test_exit_code"),
  testDurationMs: integer("test_duration_ms"),
  testLogAttachmentId: uuid("test_log_attachment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AutofixApplyRow = typeof autofixApplies.$inferSelect;
export type NewAutofixApply = typeof autofixApplies.$inferInsert;
