// C4 · luật excerpt task (plan-step0 §1). Thuần. `canAct`/`TaskFacts` đã tách sang `domain/tasks/task-access.rules.ts` (P-d1 T9s).
import { TASK_EXCERPT_MAX } from "@ai/contracts/chat";

const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

/** C4 · ≤ `max` đơn vị UTF-16 đầu của input run (khớp `z.string().max`), không cắt đôi cặp surrogate. */
export function askExcerpt(input: string, max: number = TASK_EXCERPT_MAX): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  return HIGH_SURROGATE.test(cut) ? cut.slice(0, -1) : cut;
}
