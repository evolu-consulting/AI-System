// CR-122 · E2b · FLOW2-FR-12/15 · flow-model.md mục B: node Duyệt độc lập (họ work, không AI) — người/Group của bước quyết qua cổng
// kiểm có sẵn (`after: review` — nhắc, chuyển cấp, loại trừ người gửi giữ nguyên). Duyệt ⇒ bước kế; Từ chối ⇒ `reject_step`;
// Trả lại ⇒ `return_step` (thường là node Kết thúc · Từ chối / Trả lại). Đích `null` ⇒ hành vi cổng cũ (Từ chối kết thúc lượt,
// Trả lại quay lại bước theo `back_to_steps`). Không import `./processes`.
import { z } from "zod";
import { ProcessStepSchema } from "../chat/processes";
import { UuidSchema } from "../common";
import { StageGroupKeySchema } from "./process-group-refs";

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

// ── CR-125 · purchase-flow G3 · «A + B cùng duyệt»: `after.parallel` của bước Duyệt. Mọi nhóm nhận thẻ CÙNG LÚC; bước Đạt khi đủ
// `rule` (all = mọi nhóm · any = một nhóm · {min:n} = n nhóm); Từ chối / Trả lại của BẤT KỲ nhóm nào thắng ngay (thẻ khác đóng).
export const PARALLEL_GROUPS = { min: 2, max: 5 } as const;
export const PARALLEL_LABEL_MAX = 80;
/** Một nhóm cùng duyệt: mã (mẫu Thư viện) hoặc id (bản công ty; mã thiếu khi gán ⇒ `null` = chưa chọn nhóm) + nhãn nghiệp vụ. */
export const ParallelGroupSchema = z.strictObject({
  group_key: StageGroupKeySchema.optional(),
  group_id: UuidSchema.nullable().optional(),
  label: z.string().trim().min(1).max(PARALLEL_LABEL_MAX),
});
export const ParallelRuleSchema = z.union([
  z.literal("all"),
  z.literal("any"),
  z.strictObject({ min: z.number().int().min(1).max(PARALLEL_GROUPS.max) }),
]);
/** Hình dạng thôi (số nhóm / `min` ≤ số nhóm kiểm ở `parallelStageIssues` ⇒ 422 có path, không 400). */
export const ApproveParallelSchema = z.strictObject({
  groups: z.array(ParallelGroupSchema).max(PARALLEL_GROUPS.max),
  rule: ParallelRuleSchema,
});
export type ApproveParallel = z.infer<typeof ApproveParallelSchema>;
export type ParallelRule = z.infer<typeof ParallelRuleSchema>;

/** Số nhóm Đạt cần để bước Đạt. */
export function parallelNeed(p: { groups: readonly unknown[]; rule: ParallelRule }): number {
  if (p.rule === "all") return p.groups.length;
  if (p.rule === "any") return 1;
  return p.rule.min;
}

export const PARALLEL_CODES = ["PARALLEL_GROUPS_MIN2", "PARALLEL_RULE_INVALID"] as const;
export type ParallelCode = (typeof PARALLEL_CODES)[number];
/** Khoá i18n chuẩn của mã (`check:error-codes`). */
export const PARALLEL_KEY = "process.admin.parallel.err";

type ParallelDraft = {
  executor: { kind: string };
  after: { kind: string; parallel?: { groups: readonly unknown[]; rule: unknown } };
};
/**
 * PARALLEL_GROUPS_MIN2: cần ≥ 2 nhóm (1 nhóm = bước Duyệt thường). PARALLEL_RULE_INVALID: `min` vượt số nhóm, hoặc `parallel` ở bước
 * không phải Duyệt, hoặc trùng nhóm (cùng mã / cùng id).
 */
export function parallelStageIssues(
  stages: readonly ParallelDraft[],
): { path: string; rule: ParallelCode }[] {
  const out: { path: string; rule: ParallelCode }[] = [];
  stages.forEach((s, i) => {
    const p = s.after.kind === "review" ? s.after.parallel : undefined;
    if (!p) return;
    const path = `stages.${i}.after.parallel`;
    if (s.executor.kind !== "approve") {
      out.push({ path, rule: "PARALLEL_RULE_INVALID" });
      return;
    }
    if (p.groups.length < PARALLEL_GROUPS.min)
      out.push({ path: `${path}.groups`, rule: "PARALLEL_GROUPS_MIN2" });
    const ids = p.groups.map((g) => {
      const o = g as { group_key?: string; group_id?: string | null };
      return o.group_key ?? o.group_id ?? "";
    });
    const dup = new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length;
    const r = p.rule as ParallelRule;
    const badMin = typeof r === "object" && r.min > p.groups.length;
    if (dup || badMin) out.push({ path: `${path}.rule`, rule: "PARALLEL_RULE_INVALID" });
  });
  return out;
}
