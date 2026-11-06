// CR-122 · E2 · FLOW2-FR-12/15 · flow-model.md mục B, H2: luật thuần của bước gộp (`next_step`), node Kết thúc (`outcome`) và
// "Cần xử lý" khi dữ kiện đổi sau lúc rẽ. Lớp 1, không I/O.
import { evaluateWhen, type FactValue, type IfExec } from "../if/if.rules";

/** Kết quả app của bước `step` (stage đầu tiên có `outcome`); bước không có node Kết thúc ⇒ null. */
export function outcomeOfStep(
  outcomes: readonly (string | undefined)[],
  steps: readonly number[],
  step: number,
): { idx: number; outcome: string } | null {
  for (const [i, s] of steps.entries()) {
    const o = outcomes[i];
    if (s === step && o !== undefined) return { idx: i, outcome: o };
  }
  return null;
}

/** Bước gộp sau `step`: `next_step` lớn nhất (> step, có thật) của các stage trong bước; không có ⇒ null (đi bước kế). */
export function mergeTarget(
  nextSteps: readonly (number | undefined)[],
  steps: readonly number[],
  step: number,
): number | null {
  let best: number | null = null;
  steps.forEach((s, i) => {
    const n = nextSteps[i];
    if (s !== step || n === undefined || !Number.isInteger(n) || n <= step) return;
    if (!steps.includes(n)) return;
    if (best === null || n > best) best = n;
  });
  return best;
}

/** Một lần rẽ đã ghi của node Nếu có vế `fact`. */
export type IfDecision = { stageIdx: number; matched: boolean };

/**
 * H2 · node Nếu nào (đã rẽ theo dữ kiện) nay cho kết quả KHÁC với lúc rẽ ⇒ lượt tới Kết thúc phải dừng "Cần xử lý". Đánh giá lại
 * bằng giá trị HIỆN TẠI (`facts`, + fields/inputs như lúc rẽ). Trả stage Nếu đầu tiên lệch (để chạy lại từ đó) hoặc null.
 */
export function driftedIf(
  decisions: readonly IfDecision[],
  ifs: readonly (IfExec | null)[],
  now: {
    fieldsByStageKey: Parameters<typeof evaluateWhen>[1];
    inputs: Parameters<typeof evaluateWhen>[2];
    facts: Readonly<Record<string, FactValue>> | null;
  },
): number | null {
  for (const d of [...decisions].sort((a, b) => a.stageIdx - b.stageIdx)) {
    const ifx = ifs[d.stageIdx];
    if (!ifx) continue;
    const { matched } = evaluateWhen(ifx.when, now.fieldsByStageKey, now.inputs, now.facts);
    if (matched !== d.matched) return d.stageIdx;
  }
  return null;
}

/** Stage của mọi bước SAU `step` (node Kết thúc kết thúc lượt ⇒ các nhánh còn lại bị bỏ qua). */
export const stagesAfter = (steps: readonly number[], step: number): number[] =>
  steps.flatMap((s, i) => (s > step ? [i] : []));
