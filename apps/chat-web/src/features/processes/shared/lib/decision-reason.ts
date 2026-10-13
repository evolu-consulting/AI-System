// CR-056 · P-a: lý do "Cần người quyết" (14 mã) → khoá i18n + tham số. Thuần.
import {
  ASKS_MAX,
  type DecisionReason,
  PROCESS_BACK_ROUNDS_MAX,
  REDO_MAX,
} from "@ai/contracts/chat";

export const reasonKey = (r: DecisionReason) => `process.common.${r}`;

/** Dòng giải thích dưới lý do: `source_unresolvable` (P-b), `autofix_check_failed` / `sandbox_unavailable` (P-c1); mã khác ⇒ `null`. */
export const reasonHintKey = (r: DecisionReason): string | null =>
  r === "source_unresolvable" || r === "autofix_check_failed" || r === "sandbox_unavailable"
    ? `process.common.${r}_hint`
    : null;

/** Tham số nội suy của câu lý do (`{{max}}` ở `redo_limit`, `ask_limit`, `back_limit` P-b2). */
export function reasonParams(r: DecisionReason): { max?: number } {
  if (r === "redo_limit") return { max: REDO_MAX };
  if (r === "ask_limit") return { max: ASKS_MAX };
  if (r === "back_limit") return { max: PROCESS_BACK_ROUNDS_MAX };
  return {};
}
