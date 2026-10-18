// CR-056 · P-a: lý do "Cần người quyết" (14 mã) → khoá i18n + tham số. Thuần.
import {
  ASKS_MAX,
  type DecisionReason,
  PROCESS_BACK_ROUNDS_MAX,
  REDO_MAX,
  STAGE_RETRY_MAX,
} from "@ai/contracts/chat";

export const reasonKey = (r: DecisionReason) => `process.common.${r}`;

/** P-c1: hai lý do của tự sửa mã (tiêu đề dạng heading, chỉ 2 nút Thêm lượt / Huỷ). */
export const isAutofixReason = (r: DecisionReason | undefined): boolean =>
  r === "autofix_check_failed" || r === "sandbox_unavailable";

/** P-c2: hai lý do của stage Áp (cũng dạng heading, chỉ 2 nút Thêm lượt / Huỷ). */
export const isApplyReason = (r: DecisionReason | undefined): boolean =>
  r === "apply_conflict" || r === "apply_failed";

/** Dòng giải thích dưới lý do: `source_unresolvable` (P-b), `autofix_check_failed` / `sandbox_unavailable` (P-c1); mã khác ⇒ `null`. */
export const reasonHintKey = (r: DecisionReason): string | null =>
  r === "source_unresolvable" ||
  r === "autofix_check_failed" ||
  r === "sandbox_unavailable" ||
  r === "apply_conflict" ||
  r === "retry_exhausted" ||
  r === "tool_failed" ||
  r === "timer_invalid"
    ? `process.common.${r}_hint`
    : null;

/** Tham số nội suy của câu lý do (`{{max}}` ở `redo_limit`, `ask_limit`, `back_limit` P-b2). */
export function reasonParams(r: DecisionReason): { max?: number } {
  if (r === "redo_limit") return { max: REDO_MAX };
  if (r === "ask_limit") return { max: ASKS_MAX };
  if (r === "back_limit") return { max: PROCESS_BACK_ROUNDS_MAX };
  if (r === "retry_exhausted") return { max: STAGE_RETRY_MAX };
  return {};
}
