// HUB-FR-147 · AC-H45 · P-d2 (plan-frontend-d2 §10; spec-d2 PD2-R11/R12): luật thuần của khối "Rẽ nhánh" — phép so sánh theo kiểu
// trường, stage đứng một mình trong bước, cạnh rẽ nhánh cho canvas. Thuần, built-in (ADR-0023).
// Hằng khai lại (ADR-0023: domain không import @ai/contracts); parity ở `lib/domain-contract.test.ts`.
export const BRANCH_OPS = ["eq", "ne", "lt", "le", "gt", "ge"] as const;
export const BRANCH_RULES_MAX = 10;
export type BranchOp = (typeof BRANCH_OPS)[number];
export type BranchFieldType = "number" | "string" | "date";

const ORDER_OPS: readonly BranchOp[] = ["lt", "le", "gt", "ge"];

/** Phép so sánh dùng được cho trường kiểu `type`: `lt…ge` chỉ cho Số/Ngày. */
export function opsForType(type: string): readonly BranchOp[] {
  return type === "string" ? BRANCH_OPS.filter((o) => !ORDER_OPS.includes(o)) : BRANCH_OPS;
}

/** Stage `i` đứng một mình trong bước của nó (chỉ khi đó rẽ nhánh được). */
export const isStandalone = (stages: readonly { step: number }[], i: number): boolean => {
  const step = stages[i]?.step;
  return stages.filter((s) => s.step === step).length === 1;
};

/** Bước đích chọn được: bước có thật và đứng sau `step` (0-based). */
export function gotoSteps(stages: readonly { step: number }[], step: number): number[] {
  const count = stages.reduce((m, s) => Math.max(m, s.step + 1), 0);
  return Array.from({ length: Math.max(0, count - step - 1) }, (_, k) => step + 1 + k);
}

/** Bước đích có giai đoạn `real_action` (⇒ stage nguồn phải do người duyệt). */
export const targetHasReal = (
  stages: readonly { step: number; real: boolean }[],
  goto: number | null,
): boolean => goto !== null && stages.some((s) => s.step === goto && s.real);
