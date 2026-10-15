// HUB-FR-129 · HUB-FR-130 · WRK-FR-29 · P-c2 (plan §3.5): `POST /internal/jobs/:job_id/apply-result` → 201 `{id}`
// (`JobOutputResponse`). Báo cáo job `source.apply`; `detail` đã che (Runtime `redact` + `redact_auth`) — không bí mật.
import { z } from "zod";
import {
  APPLY_CONFLICT_FILES_MAX,
  APPLY_DETAIL_MAX,
  APPLY_FILE_PATH_MAX,
  APPLY_REPORT_STATUSES,
  ApplyJobCodeSchema,
  AUTOFIX_FAILURES_MAX,
  AutofixFailureSchema,
} from "../hub-admin/autofix";
import { AutofixTestSchema } from "./autofix";

/** Trần thân request (C30: 401 xét trước 413 `PAYLOAD_TOO_LARGE`). */
export const APPLY_BODY_MAX_BYTES = 256 * 1024;
const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const ApplyReportSchema = z
  .strictObject({
    status: z.enum(APPLY_REPORT_STATUSES),
    /** null chỉ khi `failed` trước khi fetch được nhánh đích. */
    target_sha: GitShaSchema.nullable(),
    head_sha: GitShaSchema.nullable(),
    rebased: z.boolean(),
    code: ApplyJobCodeSchema.nullable(),
    conflict_files: z
      .array(z.string().min(1).max(APPLY_FILE_PATH_MAX))
      .max(APPLY_CONFLICT_FILES_MAX),
    failures: z.array(AutofixFailureSchema).max(AUTOFIX_FAILURES_MAX),
    test: AutofixTestSchema.nullable(),
    // B1 (P-c2 D3 UAT): Runtime `report.py` luôn gửi key `detail` = null khi không có chi tiết (các field anh em đều
    // `.nullable()`); `.nullish()` = nullable + optional để nhận cả null, bỏ trống, lẫn chuỗi ≤ 300.
    detail: z.string().max(APPLY_DETAIL_MAX).nullish(),
  })
  .superRefine((r, ctx) => {
    const add = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if ((r.head_sha !== null) !== (r.status === "pushed")) add("head_sha", "head_sha iff pushed");
    if ((r.code !== null) !== (r.status === "failed")) add("code", "code iff failed");
    if (r.status !== "conflict" && r.conflict_files.length > 0)
      add("conflict_files", "conflict_files only when conflict");
    if (r.status !== "check_failed" && r.failures.length > 0)
      add("failures", "failures only when check_failed");
    if (r.target_sha === null && r.status !== "failed") add("target_sha", "target_sha required");
  });
export type ApplyReport = z.infer<typeof ApplyReportSchema>;
