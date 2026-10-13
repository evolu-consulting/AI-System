// HUB-FR-130 · WRK-FR-29 · P-c1 (plan §3.3): `POST /internal/jobs/:job_id/autofix-result` → 201 `{id}` (`JobOutputResponse`).
// Báo cáo sandbox tự-sửa: diff + kết quả test + lỗi kiểm tra. KHÔNG mang giá trị bí mật (PC-R08).
import { z } from "zod";
import { AUTOFIX_BRANCH_RE } from "../hub/job";
import {
  AUTOFIX_DIFF_MAX_BYTES,
  AUTOFIX_FAILURES_MAX,
  AUTOFIX_LOG_TAIL_MAX,
  AutofixDiffStatsSchema,
  AutofixFailureSchema,
  AutofixStatusSchema,
} from "../hub-admin/autofix";

export const AUTOFIX_COMMANDS_MAX = 300;
export const AUTOFIX_BODY_MAX_BYTES = 3 * 1024 * 1024;
const GitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const encoder = new TextEncoder();

export const AutofixTestSchema = z.strictObject({
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().int().min(0),
  log_tail: z.string().max(AUTOFIX_LOG_TAIL_MAX),
});
export const AutofixCommandSchema = z.strictObject({
  tool: z.enum(["exec", "read", "write", "edit"]),
  arg: z.string().max(500),
  exit_code: z.number().int().optional(),
  ms: z.number().int().min(0),
});

export const AutofixReportSchema = z
  .strictObject({
    status: AutofixStatusSchema,
    branch: z.string().regex(AUTOFIX_BRANCH_RE),
    base_sha: GitShaSchema,
    head_sha: GitShaSchema,
    diff: z.string().max(AUTOFIX_DIFF_MAX_BYTES).nullable(),
    diff_stats: AutofixDiffStatsSchema.nullable(),
    test: AutofixTestSchema.nullable(),
    failures: z.array(AutofixFailureSchema).max(AUTOFIX_FAILURES_MAX),
    commands: z.array(AutofixCommandSchema).max(AUTOFIX_COMMANDS_MAX),
  })
  .superRefine((r, ctx) => {
    const isOk = r.status === "ok";
    if ((r.diff !== null) !== isOk)
      ctx.addIssue({ code: "custom", path: ["diff"], message: "diff iff status=ok" });
    if ((r.diff_stats !== null) !== isOk)
      ctx.addIssue({ code: "custom", path: ["diff_stats"], message: "diff_stats iff status=ok" });
    if (r.diff !== null && encoder.encode(r.diff).length > AUTOFIX_DIFF_MAX_BYTES)
      ctx.addIssue({ code: "custom", path: ["diff"], message: "diff > 2 MiB" });
  });
export type AutofixReport = z.infer<typeof AutofixReportSchema>;
