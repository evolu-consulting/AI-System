// HUB-FR-147 · AC-H45 · PD2-R12…R15 · D12 · D2-08 · plan-d2-rules §1: đánh giá rẽ nhánh khi stage chốt `done` (trong bộ nhớ,
// trên `fields` đã đọc — không câu SQL theo luật/bước), stage bị nhảy qua, bước liền trước có hiệu lực. Thuần, lớp 1.
import type { StageRunStatus } from "../types";
import type { BranchRule } from "./branch-def.rules";

type FieldValue = string | number;

/** So `a op b`; khác kiểu (sau ép số từ chuỗi số khi luật là số) ⇒ không khớp. Date so chuỗi `YYYY-MM-DD`. */
export function compare(op: BranchRule["op"], raw: FieldValue, want: FieldValue): boolean {
  const a =
    typeof want === "number" && typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof a !== typeof want || (typeof a === "number" && !Number.isFinite(a))) return false;
  switch (op) {
    case "eq":
      return a === want;
    case "ne":
      return a !== want;
    case "lt":
      return a < want;
    case "le":
      return a <= want;
    case "gt":
      return a > want;
    case "ge":
      return a >= want;
  }
}

/** PD2-R13 · luật ĐẦU TIÊN khớp (theo thứ tự mảng) ⇒ `{gotoStep, rule}` (`rule` đếm từ 1); trường vắng / `null` ⇒ không khớp. */
export function evaluateBranch(
  rules: readonly BranchRule[],
  fields: Readonly<Record<string, FieldValue>> | null,
): { gotoStep: number; rule: number } | null {
  if (!fields) return null;
  for (const [i, r] of rules.entries()) {
    const v = Object.hasOwn(fields, r.field) ? fields[r.field] : undefined;
    if (v !== undefined && v !== null && compare(r.op, v, r.value))
      return { gotoStep: r.gotoStep, rule: i + 1 };
  }
  return null;
}

/** PD2-R13 · chỉ số stage thuộc các bước nằm GIỮA `fromStep` và `gotoStep` (không gồm hai đầu), tăng dần. */
export function skippedStages(
  steps: readonly number[],
  fromStep: number,
  gotoStep: number,
): number[] {
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (s > fromStep && s < gotoStep) out.push(i);
  });
  return out;
}

/** D2-08 · bước gần nhất TRƯỚC `step` không toàn `skipped`; không có ⇒ null. */
export function effectivePrevStep(
  stepStatuses: ReadonlyMap<number, readonly StageRunStatus[]>,
  step: number,
): number | null {
  for (let k = step - 1; k >= 0; k--) {
    const st = stepStatuses.get(k) ?? [];
    if (!(st.length > 0 && st.every((s) => s === "skipped"))) return k;
  }
  return null;
}
