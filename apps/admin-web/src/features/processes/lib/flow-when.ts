// CR-105 · L3: điều kiện áp dụng của một bước (chuyển từ contracts-web `flow-path.ts`, phần `whenParts`/`buildWhen`):
// loại HĐ (nhiều) AND/OR giá trị (≥ > ≤ <) — đúng dạng `stage.slot.when` (FlowWhen).
import type { FlowCond, FlowWhen } from "@ai/contracts";
import type { DealKind } from "../library-api";

export type ValueOp = "ge" | "gt" | "le" | "lt";
export const DEALS: readonly DealKind[] = ["buy", "sell", "referral"];
export const VALUE_OPS: readonly [ValueOp, string][] = [
  ["ge", "≥"],
  ["gt", ">"],
  ["le", "≤"],
  ["lt", "<"],
];

/** Tách `when` thành phần UI: loại HĐ (một vế) + giá trị (một vế). */
export function whenParts(w: FlowWhen): {
  deal: DealKind[];
  value: { op: ValueOp; value: number } | null;
} {
  const d = w.conds.find((c) => c.field === "deal");
  const v = w.conds.find((c) => c.field === "total_value");
  return {
    deal: d?.field === "deal" ? ([...d.in] as DealKind[]) : [],
    value: v?.field === "total_value" ? { op: v.op, value: v.value } : null,
  };
}

/** Ghép lại `when` từ phần UI (conds rỗng khi đang soạn dở ⇒ bị chặn ở `validateFlow`). */
export function buildWhen(
  op: "and" | "or",
  deal: readonly DealKind[],
  value: { op: ValueOp; value: number } | null,
): FlowWhen {
  const conds: FlowCond[] = [];
  if (deal.length > 0) conds.push({ field: "deal", in: [...deal] } as FlowCond);
  if (value) conds.push({ field: "total_value", op: value.op, value: value.value });
  return { op, conds };
}
