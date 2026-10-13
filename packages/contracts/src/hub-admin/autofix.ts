// HUB-FR-126 · HUB-FR-128 · WRK-FR-29 · P-c1 (plan §3): kiểu dùng chung stage tự-sửa — def (hub-admin), job (hub), báo cáo
// (hub-internal) và view (chat). Không import chat/hub để tránh vòng.
import { z } from "zod";
import { GlobSchema, STAGE_ALLOWLIST_MAX } from "./sources";

export const AUTOFIX_CMD_MAX = 1_000;
export const AUTOFIX_STATUSES = ["ok", "no_changes", "check_failed"] as const;
export const AutofixStatusSchema = z.enum(AUTOFIX_STATUSES);
export type AutofixStatus = z.infer<typeof AutofixStatusSchema>;
export const AUTOFIX_CHECKS = [
  "paths",
  "size",
  "secrets",
  "tests",
  "install",
  "apply_patch",
] as const;
export const AUTOFIX_FAILURES_MAX = 50;
export const AUTOFIX_DIFF_MAX_BYTES = 2_097_152;
export const AUTOFIX_FILES_MAX = 300;
export const AUTOFIX_LOG_TAIL_MAX = 65_536;

/** Lệnh shell: trim, 1..1000, không NUL. */
export const AutofixCmdSchema = z
  .string()
  .trim()
  .min(1)
  .max(AUTOFIX_CMD_MAX)
  .refine((v) => !v.includes("\0"), "null byte");
export const AutofixWriteAllowlistSchema = z.array(GlobSchema).max(STAGE_ALLOWLIST_MAX);

/** PC-R01 · lỗi một kiểm tra — KHÔNG mang giá trị bí mật (`detail` ≤ 500). */
export const AutofixFailureSchema = z.strictObject({
  check: z.enum(AUTOFIX_CHECKS),
  path: z.string().max(1024).optional(),
  line: z.number().int().optional(),
  rule: z.string().max(64).optional(),
  detail: z.string().max(500),
});
export type AutofixFailure = z.infer<typeof AutofixFailureSchema>;

export const AutofixDiffStatsSchema = z.strictObject({
  files: z.number().int().min(0).max(AUTOFIX_FILES_MAX),
  insertions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  bytes: z.number().int().min(0),
});
export type AutofixDiffStats = z.infer<typeof AutofixDiffStatsSchema>;
