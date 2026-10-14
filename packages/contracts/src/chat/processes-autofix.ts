// HUB-FR-128 · HUB-FR-129 · HUB-FR-130 · P-c1/P-c2 (plan §3.6): view stage tự-sửa + stage Áp của run. Tách khỏi
// `processes-entities.ts` (giữ ≤ 400 dòng); export qua `@ai/contracts/chat`. Mọi object strict; không I/O.
import { z } from "zod";
import { IsoDateTime, UuidSchema } from "../common";
import {
  APPLY_CONFLICT_FILES_MAX,
  APPLY_FILE_PATH_MAX,
  ApplyErrorCodeSchema,
  ApplyStatusSchema,
  AUTOFIX_FAILURES_MAX,
  AutofixDiffStatsSchema,
  AutofixFailureSchema,
  AutofixStatusSchema,
} from "../hub-admin/autofix";
import { ApplyModeSchema, GIT_PROVIDERS, SOURCE_BRANCH_MAX } from "../hub-admin/sources";

const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

/** P-c1 · file diff/log của stage tự-sửa (map từ `hub.attachments`: `filename`→`name`). */
export const AutofixFileSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  size: z.number().int().min(0),
});
export type AutofixFile = z.infer<typeof AutofixFileSchema>;

/** P-c1 · HUB-FR-128 · kết quả tự-sửa của stage (run view). `pin_sha` chỉ khi pin git_remote (không lộ path/snapshot). */
export const AutofixStageViewSchema = z.strictObject({
  source_key: z.string().min(1).max(64),
  pin_sha: GitShaSchema.nullable(),
  branch: z.string().min(1).max(128),
  round: z.number().int().min(1),
  status: AutofixStatusSchema,
  diff_stats: AutofixDiffStatsSchema.nullable(),
  diff_file: AutofixFileSchema.nullable(),
  test_log_file: AutofixFileSchema.nullable(),
  test: z
    .strictObject({ exit_code: z.number().int().nullable(), duration_ms: z.number().int().min(0) })
    .nullable(),
  failures: z.array(AutofixFailureSchema).max(AUTOFIX_FAILURES_MAX),
  created_at: IsoDateTime,
  /**
   * P-c2 · C7/C43 · `effectiveApplyMode(nguồn hiện tại)` khi def có stage Áp, ngược lại null. Hub luôn gửi; optional
   * trong kiểu để fixture/view cũ (trước P-c2) vẫn hợp lệ — FE đọc `?? null`.
   */
  apply_mode: ApplyModeSchema.nullable().optional(),
  /** P-c2 · C9 · `config.branch` nguồn hiện tại khi `apply_mode ≠ null` và nguồn `git_remote`; ngược lại null. */
  apply_base: z.string().min(1).max(SOURCE_BRANCH_MAX).nullable().optional(),
});
export type AutofixStageView = z.infer<typeof AutofixStageViewSchema>;

/** P-c2 · HUB-FR-129/130 · kết quả stage Áp (hàng `autofix_applies` mới nhất). Không `detail` thô — chỉ `error_code`. */
export const ApplyStageViewSchema = z
  .strictObject({
    mode: ApplyModeSchema,
    status: ApplyStatusSchema,
    branch: z.string().min(1).max(128).nullable(),
    target_sha: GitShaSchema.nullable(),
    head_sha: GitShaSchema.nullable(),
    rebased: z.boolean(),
    provider: z.enum(GIT_PROVIDERS).nullable(),
    pr_number: z.number().int().min(1).nullable(),
    pr_url: z.string().min(1).max(2048).nullable(),
    auto_merge: z.enum(["on", "failed"]).nullable(),
    error_code: ApplyErrorCodeSchema.nullable(),
    conflict_files: z
      .array(z.string().min(1).max(APPLY_FILE_PATH_MAX))
      .max(APPLY_CONFLICT_FILES_MAX),
    failures: z.array(AutofixFailureSchema).max(AUTOFIX_FAILURES_MAX),
    test_log_file: AutofixFileSchema.nullable(),
    created_at: IsoDateTime,
  })
  .superRefine((v, ctx) => {
    // C11 · failed/check_failed ⇒ có mã; check_failed ⇒ đúng "check_failed".
    if ((v.status === "failed" || v.status === "check_failed") && v.error_code === null)
      ctx.addIssue({ code: "custom", path: ["error_code"], message: "error_code required" });
    if (v.status === "check_failed" && v.error_code !== null && v.error_code !== "check_failed")
      ctx.addIssue({ code: "custom", path: ["error_code"], message: "must be check_failed" });
  });
export type ApplyStageView = z.infer<typeof ApplyStageViewSchema>;
