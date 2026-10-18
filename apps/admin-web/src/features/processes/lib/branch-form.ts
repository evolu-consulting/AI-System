// ADM-FR-71 · HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; plan-d2-rules): luật rẽ nhánh của editor — đổi qua lại với
// contract (`goto_step` 0-based ⇄ UI đếm từ 1), giá trị theo kiểu trường. Hàm thuần (không React, không gọi API).
import type { BranchRule } from "@ai/contracts/hub-admin";
import type { BranchDraft, FieldDraft } from "./draft-types";

export const emptyBranch = (): BranchDraft => ({ field: "", op: "eq", value: "", goto: null });

/** Giá trị luật theo kiểu trường: Số ⇒ number (không hợp lệ ⇒ NaN), còn lại chuỗi. */
function ruleValue(b: BranchDraft, type: FieldDraft["type"] | undefined): string | number {
  if (type !== "number") return b.value;
  return b.value.trim() === "" ? Number.NaN : Number(b.value);
}

/** Bản nháp → luật contract; `fields` để biết kiểu trường của `field`. Luật chưa chọn đích ⇒ `goto_step = -1` (bị `branchStageIssues` bắt). */
export function branchToRules(
  branch: readonly BranchDraft[],
  fields: readonly FieldDraft[],
): BranchRule[] {
  return branch.map((b) => ({
    field: b.field,
    op: b.op as BranchRule["op"],
    value: ruleValue(b, fields.find((f) => f.key === b.field)?.type),
    goto_step: b.goto === null ? -1 : b.goto - 1,
  }));
}

export function rulesToBranch(rules: readonly BranchRule[] | undefined): BranchDraft[] {
  return (rules ?? []).map((r) => ({
    field: r.field,
    op: r.op,
    value: String(r.value),
    goto: r.goto_step + 1,
  }));
}

/** Ô lỗi của luật `j` ở stage `i`: path server `stages.i.after.branch.j.<ô>`; `cell` vắng ⇒ lỗi cả khối (`stages.i.after.branch`). */
export function branchErrorAt(
  errors: Record<string, string>,
  i: number,
  j?: number,
  cell?: "field" | "op" | "value" | "goto_step",
): string | undefined {
  const base = `stages.${i}.after.branch`;
  return j === undefined || cell === undefined ? errors[base] : errors[`${base}.${j}.${cell}`];
}
