// CR-056 · P-a: lý do "Cần người quyết" (14 mã) → khoá i18n + tham số. Thuần.
import { ASKS_MAX, type DecisionReason, REDO_MAX } from "@ai/contracts/chat";

export const reasonKey = (r: DecisionReason) => `process.common.${r}`;

/** P-b: một dòng giải thích dưới lý do (chỉ `source_unresolvable`); mã khác ⇒ `null`. */
export const reasonHintKey = (r: DecisionReason): string | null =>
  r === "source_unresolvable" ? "process.common.source_unresolvable_hint" : null;

/** Tham số nội suy của câu lý do (`{{max}}` ở `redo_limit` và `ask_limit`). */
export function reasonParams(r: DecisionReason): { max?: number } {
  if (r === "redo_limit") return { max: REDO_MAX };
  if (r === "ask_limit") return { max: ASKS_MAX };
  return {};
}
