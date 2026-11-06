// CR-122 · E2b · FLOW2-FR-12/15 · flow-model.md mục B: node Duyệt độc lập (họ work, không AI) — người/Group của bước quyết qua cổng
// kiểm có sẵn (`after: review` — nhắc, chuyển cấp, loại trừ người gửi giữ nguyên). Duyệt ⇒ bước kế; Từ chối ⇒ `reject_step`;
// Trả lại ⇒ `return_step` (thường là node Kết thúc · Từ chối / Trả lại). Đích `null` ⇒ hành vi cổng cũ (Từ chối kết thúc lượt,
// Trả lại quay lại bước theo `back_to_steps`). Không import `./processes`.
import { z } from "zod";
import { ProcessStepSchema } from "../chat/processes";

/** Trường output node Duyệt ghi khi người quyết (`decision`) — node Nếu / rẽ bước đọc được. */
export const APPROVE_DECISION_FIELD = "decision";
export const APPROVE_DECISIONS = ["approved", "rejected", "returned"] as const;
export type ApproveDecision = (typeof APPROVE_DECISIONS)[number];

export const ApproveExecutorSchema = z.strictObject({
  kind: z.literal("approve"),
  reject_step: ProcessStepSchema.nullable(),
  return_step: ProcessStepSchema.nullable(),
});
export type ApproveExecutor = z.infer<typeof ApproveExecutorSchema>;

type ApproveDraft = {
  step?: number;
  real_action: boolean;
  after: { kind: string };
  executor: { kind: string; reject_step?: number | null; return_step?: number | null };
};

/** APPROVE_INVALID: phải `after: review` (người quyết), không `real_action`, một mình trong bước, đích (nếu có) là bước SAU có thật. */
export function approveStageIssues(
  stages: readonly ApproveDraft[],
  steps: readonly number[],
): { path: string; rule: "APPROVE_INVALID" }[] {
  const out: { path: string; rule: "APPROVE_INVALID" }[] = [];
  const count = steps.length === 0 ? 0 : Math.max(...steps) + 1;
  stages.forEach((s, i) => {
    const e = s.executor;
    if (e.kind !== "approve") return;
    const own = steps[i] as number;
    const alone = steps.filter((v) => v === own).length === 1;
    if (s.after.kind !== "review" || s.real_action || !alone)
      out.push({ path: `stages.${i}`, rule: "APPROVE_INVALID" });
    for (const k of ["reject_step", "return_step"] as const) {
      const t = e[k];
      if (t == null) continue;
      if (!Number.isInteger(t) || t <= own || t >= count)
        out.push({ path: `stages.${i}.executor.${k}`, rule: "APPROVE_INVALID" });
    }
  });
  return out;
}
