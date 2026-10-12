// P-b2 · CHAT-AC-59 · plan-frontend §3: gom giai đoạn theo BƯỚC (song song). Thuần. Thiếu `step` (run/def cũ) ⇒ step = idx
// ⇒ mỗi giai đoạn một bước ⇒ giao diện y như P-a/P-b (AC-PB2-01). Cùng luật `resolveSteps` của contract (không import để
// chat-web không kéo cả `hub-admin`): mọi phần tử có `step` ⇒ dùng; ngược lại ⇒ chỉ số.

export type StepItem = { idx: number; step?: number };
export type StepGroup<T extends StepItem> = {
  /** Bước 0-based (UI hiện `step + 1`). */
  step: number;
  items: T[];
};

/** Nhóm theo bước tăng dần; trong nhóm giữ thứ tự đầu vào. */
export function groupBySteps<T extends StepItem>(items: readonly T[]): StepGroup<T>[] {
  const useStep = items.length > 0 && items.every((s) => typeof s.step === "number");
  const by = new Map<number, T[]>();
  for (const s of items) {
    const k = useStep ? (s.step as number) : s.idx;
    const g = by.get(k);
    if (g) g.push(s);
    else by.set(k, [s]);
  }
  return [...by.keys()].sort((a, b) => a - b).map((k) => ({ step: k, items: by.get(k) as T[] }));
}

/** Có nên hiện nhãn "Bước n"/×lần: có bước ≥ 2 giai đoạn hoặc có giai đoạn đã làm lại (`round > 1`). */
export function showSteps(items: readonly (StepItem & { round?: number })[]): boolean {
  return (
    groupBySteps(items).some((g) => g.items.length > 1) || items.some((s) => (s.round ?? 1) > 1)
  );
}

/** Vòng lớn nhất trong nhóm (huy hiệu ×lần của cả bước). */
export const groupRound = (g: StepGroup<StepItem & { round?: number }>): number =>
  Math.max(1, ...g.items.map((s) => s.round ?? 1));

/** Số bước của run ở dạng UI: `step + 1`. */
export const stepNo = (step: number): number => step + 1;

/** Bước (0-based) của mỗi giai đoạn: idx → step (cùng luật `groupBySteps`). */
export function stepOfStages(stages: readonly StepItem[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const g of groupBySteps(stages)) for (const s of g.items) m.set(s.idx, g.step);
  return m;
}

/** Q7 · xếp việc theo bước của giai đoạn (bước tăng dần, giữ thứ tự gốc trong bước). */
export function groupTasksByStep<T extends { stage_idx: number }>(
  tasks: readonly T[],
  stages: readonly StepItem[],
): { step: number; tasks: T[] }[] {
  const of = stepOfStages(stages);
  const by = new Map<number, T[]>();
  for (const t of tasks) {
    const k = of.get(t.stage_idx) ?? t.stage_idx;
    const g = by.get(k);
    if (g) g.push(t);
    else by.set(k, [t]);
  }
  return [...by.keys()].sort((a, b) => a - b).map((k) => ({ step: k, tasks: by.get(k) as T[] }));
}
