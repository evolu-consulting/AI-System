// contract-flow S5 · xem trước đường đi: hàm thuần phản chiếu luật server `nextApplicable` (bước có `when` null ⇒ luôn cần;
// AND/OR trên loại HĐ và giá trị; giá trị trống ⇒ điều kiện giá trị coi là CẦN bước; bước Dify luôn chạy).
import type { DealKind, FlowStep, StepWhen } from "../api-flow";

export type Facts = { deal: DealKind; value: number | null };

function dealHit(when: StepWhen, deal: DealKind): boolean {
  return (when.deal ?? []).includes(deal);
}
function valueHit(when: StepWhen, value: number | null): boolean {
  const v = when.value;
  if (!v) return false;
  if (value === null) return true; // giá trị trống thì vẫn cần bước này
  return v.cmp === "gte" ? value >= v.amount : value < v.amount;
}

/** Có điều kiện nào được đặt không (deal rỗng và không value = không đặt). */
export function hasCondition(when: StepWhen | null): boolean {
  return !!when && ((when.deal?.length ?? 0) > 0 || !!when.value);
}

/** Bước này cần chạy với hồ sơ này không. */
export function applies(step: FlowStep, facts: Facts): boolean {
  if (step.kind === "dify") return true;
  const w = step.when;
  if (!w || !hasCondition(w)) return true;
  const parts: boolean[] = [];
  if ((w.deal?.length ?? 0) > 0) parts.push(dealHit(w, facts.deal));
  if (w.value) parts.push(valueHit(w, facts.value));
  return w.op === "or" ? parts.some(Boolean) : parts.every(Boolean);
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
