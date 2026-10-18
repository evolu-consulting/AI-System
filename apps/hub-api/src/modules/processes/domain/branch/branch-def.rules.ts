// HUB-FR-147 · AC-H45 · PD2-R10…R12 · D12 · A10 · plan-d2-rules §1, plan-addendum A2: luật lưu def cho `after.branch` (cùng
// điều kiện + path với `branchStageIssues` của contract — parity `defs/branch-def-parity.test.ts`). Thuần, lớp 1.
import { isCalendarDate } from "../runs/start-inputs.rules";

/** Trần số luật một stage (= `BRANCH_RULES_MAX` contract). */
export const BRANCH_RULES_MAX = 10;
export const BRANCH_OPS = ["eq", "ne", "lt", "le", "gt", "ge"] as const;
export type BranchOp = (typeof BRANCH_OPS)[number];
/** `gotoStep` 0-based (= `goto_step` contract). */
export type BranchRule = { field: string; op: BranchOp; value: string | number; gotoStep: number };
/** Stage đã chuẩn hoá bước (`step` = `resolveSteps`). */
export type BranchStageShape = {
  step: number;
  realAction: boolean;
  afterKind: "review" | "auto";
  fields: readonly { key: string; type: string }[];
  branch: readonly BranchRule[];
};
export type BranchDefIssue = { path: string; rule: "BRANCH_INVALID" };

const ISSUES_MAX = 20;
const ORDER_OPS: ReadonlySet<string> = new Set(["lt", "le", "gt", "ge"]);
function valueMatches(fieldType: string, v: unknown): boolean {
  if (fieldType === "number") return typeof v === "number" && Number.isFinite(v);
  if (fieldType === "date") return typeof v === "string" && isCalendarDate(v);
  return typeof v === "string";
}

type Ctx = { stages: readonly BranchStageShape[]; i: number; stepCount: number };

/** Ô sai đầu tiên của luật theo thứ tự field → op → value → goto_step; hợp lệ ⇒ null. */
function badRuleCell(r: BranchRule, c: Ctx): string | null {
  const s = c.stages[c.i] as BranchStageShape;
  const f = s.fields.find((x) => x.key === r.field);
  if (!f) return "field";
  if (!BRANCH_OPS.includes(r.op) || (f.type === "string" && ORDER_OPS.has(r.op))) return "op";
  if (!valueMatches(f.type, r.value)) return "value";
  const g = r.gotoStep;
  if (!Number.isInteger(g) || g <= s.step || g >= c.stepCount) return "goto_step";
  // PD2-R12 · A10 · đích có `real_action` ⇒ stage rẽ nhánh phải là gate review.
  const realTarget = c.stages.some((t) => t.step === g && t.realAction);
  return realTarget && s.afterKind !== "review" ? "goto_step" : null;
}

/** PD2-R10…R12 · BRANCH_INVALID: > 10 luật / stage không đứng một mình trong bước ⇒ `after.branch`; mỗi luật ≤ 1 issue. */
export function branchStageIssues(stages: readonly BranchStageShape[]): BranchDefIssue[] {
  const stepCount = stages.length === 0 ? 0 : Math.max(...stages.map((s) => s.step)) + 1;
  const out: BranchDefIssue[] = [];
  stages.forEach((s, i) => {
    if (s.branch.length === 0) return;
    const base = `stages.${i}.after.branch`;
    const alone = stages.filter((x) => x.step === s.step).length === 1;
    if (s.branch.length > BRANCH_RULES_MAX || !alone)
      out.push({ path: base, rule: "BRANCH_INVALID" });
    s.branch.forEach((r, j) => {
      const cell = badRuleCell(r, { stages, i, stepCount });
      if (cell) out.push({ path: `${base}.${j}.${cell}`, rule: "BRANCH_INVALID" });
    });
  });
  return out.slice(0, ISSUES_MAX);
}
