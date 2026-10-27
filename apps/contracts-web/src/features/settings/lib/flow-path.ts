// contract-flow S5 · xem trước đường đi: hàm thuần phản chiếu luật server `nextApplicable` (bước có `when` null ⇒ luôn cần;
// AND/OR trên các điều kiện loại HĐ / giá trị; loại trống hoặc giá trị trống ⇒ điều kiện ĐÚNG (cần bước); bước Dify luôn chạy).
import type { DealKind, FlowCond, FlowStep, FlowWhen, ValueOp } from "../api-flow";

export type Facts = { deal: DealKind; value: number | null };

function cmp(op: ValueOp, v: number, t: number): boolean {
  return op === "ge" ? v >= t : op === "gt" ? v > t : op === "le" ? v <= t : v < t;
}
function condHit(c: FlowCond, f: Facts): boolean {
  if (c.field === "deal") return c.in.length === 0 || c.in.includes(f.deal);
  if (f.value === null || !Number.isFinite(f.value)) return true; // giá trị trống thì vẫn cần bước này
  return cmp(c.op, f.value, c.value);
}

/** Có điều kiện nào được đặt không. */
export const hasCondition = (when: FlowWhen | null): boolean => !!when && when.conds.length > 0;

/** Bước này cần chạy với hồ sơ này không. */
export function applies(step: FlowStep, facts: Facts): boolean {
  if (step.kind === "dify" || step.kind === "esign") return true; // esign-flow · Ký số luôn chạy sau duyệt xong
  const w = step.when;
  if (!w || w.conds.length === 0) return true;
  const hits = w.conds.map((c) => condHit(c, facts));
  return w.op === "or" ? hits.some(Boolean) : hits.every(Boolean);
}

/** Chỉ số bước cần chạy kế tiếp sau `from` (-1 = từ đầu); null = hết. Bước 0 luôn chạy. */
export function nextApplicable(
  steps: readonly FlowStep[],
  facts: Facts,
  from: number,
): number | null {
  for (let i = from + 1; i < steps.length; i++) {
    const s = steps[i];
    if (s && (i === 0 || applies(s, facts))) return i;
  }
  return null;
}

/** Danh sách bước chạy / bỏ qua cho mẫu `facts` (theo thứ tự). */
export function previewPath(
  steps: readonly FlowStep[],
  facts: Facts,
): { index: number; run: boolean }[] {
  const out: { index: number; run: boolean }[] = [];
  let at = nextApplicable(steps, facts, -1);
  for (let i = 0; i < steps.length; i++) {
    const run = i === at;
    out.push({ index: i, run });
    if (run) at = nextApplicable(steps, facts, i);
  }
  return out;
}

/** Tách `when` thành phần UI: loại HĐ (một vế) + giá trị (một vế). */
export function whenParts(w: FlowWhen): {
  deal: DealKind[];
  value: { op: ValueOp; value: number } | null;
} {
  const d = w.conds.find((c) => c.field === "deal");
  const v = w.conds.find((c) => c.field === "total_value");
  return {
    deal: d?.field === "deal" ? [...d.in] : [],
    value: v?.field === "total_value" ? { op: v.op, value: v.value } : null,
  };
}

/** Ghép lại `when` từ phần UI (conds có thể rỗng khi đang soạn dở ⇒ bị chặn ở kiểm sơ bộ). */
export function buildWhen(
  op: "and" | "or",
  deal: readonly DealKind[],
  value: { op: ValueOp; value: number } | null,
): FlowWhen {
  const conds: FlowCond[] = [];
  if (deal.length > 0) conds.push({ field: "deal", in: [...deal] });
  if (value) conds.push({ field: "total_value", op: value.op, value: value.value });
  return { op, conds };
}
