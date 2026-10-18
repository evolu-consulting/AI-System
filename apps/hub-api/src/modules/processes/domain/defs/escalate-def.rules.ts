// HUB-FR-145 · HUB-BR-43 · PD-R23 · plan-domain §4.7: luật lưu def cho `after.escalate`. Thuần, lớp 1.
import { ESCALATE_AFTER_H } from "../limits";

/** Hình tối thiểu của stage cho luật (adapter dựng từ def). */
export type EscalateStageShape = {
  after: "review" | "auto";
  reviewGroupId: string | null;
  escalate: { afterH: number; groupId: string } | null;
};
export type EscalateDefIssue = { path: string; rule: string };

/** ESCALATE_INVALID: escalate ≠ null ∧ (after ≠ review | groupId = reviewGroupId | afterH ∉ 4…2160) — path
 *  `stages.<i>.after.escalate`. Tồn tại/cùng tenant KHÔNG xét ở đây (adapter ⇒ PROCESS_REF_INVALID). */
export function escalateStageIssues(stages: readonly EscalateStageShape[]): EscalateDefIssue[] {
  const out: EscalateDefIssue[] = [];
  for (const [i, s] of stages.entries()) {
    const e = s.escalate;
    if (!e) continue;
    const bad =
      s.after !== "review" ||
      e.groupId === s.reviewGroupId ||
      !Number.isInteger(e.afterH) ||
      e.afterH < ESCALATE_AFTER_H.min ||
      e.afterH > ESCALATE_AFTER_H.max;
    if (bad) out.push({ path: `stages.${i}.after.escalate`, rule: "ESCALATE_INVALID" });
  }
  return out;
}

/** Group đích cần kiểm tồn tại/cùng tenant (adapter ⇒ 422 PROCESS_REF_INVALID, ref "group"). */
export function escalateGroupRefs(
  stages: readonly Pick<EscalateStageShape, "escalate">[],
): { path: string; groupId: string }[] {
  const out: { path: string; groupId: string }[] = [];
  for (const [i, s] of stages.entries())
    if (s.escalate)
      out.push({ path: `stages.${i}.after.escalate.group_id`, groupId: s.escalate.groupId });
  return out;
}
