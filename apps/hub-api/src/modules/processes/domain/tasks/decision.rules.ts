// HUB-FR-106 · HUB-FR-115 · HUB-FR-143 · M5 · P-b2 D8/D9 · luật quyết định (task `decision`) — tách từ `core/task.rules.ts` (P-d1 T8s).
// Thuần, lớp 1: kiểu + hằng khai lại ở domain (khớp contract — `adapters/processes.mapper.test.ts` khẳng định).
import { REVIEW_GROUP_REASONS } from "../runs/run-access.rules";
import type { DecisionOption, DecisionReason } from "../types";

/** Thứ tự lựa chọn của task `decision` (UI dựa vào đây) = `DECISION_OPTIONS` của contract. */
export const DECISION_OPTION_ORDER: readonly DecisionOption[] = [
  "add_attempt",
  "use_current",
  "cancel",
];

/** Lý do thuộc nhóm tự-sửa / áp dụng (PC-R10, PC2-R08): không có output hợp lệ để dùng ⇒ không `use_current`. */
export const AUTOFIX_REASONS: ReadonlySet<DecisionReason> = new Set<DecisionReason>([
  "autofix_check_failed",
  "sandbox_unavailable",
  "apply_conflict",
  "apply_failed",
]);

export const isAutofixReason = (r: DecisionReason): boolean => AUTOFIX_REASONS.has(r);

/** Assignee task `decision`: người bắt đầu; Group duyệt chỉ khi `redo_limit` / `back_limit` (P-b2 D8). Admin quyết qua `canDecide`, không là assignee. */
export function decisionAssignees(
  reason: DecisionReason,
  startedBy: string,
  reviewGroupId: string | null,
): { userIds: string[]; groupId: string | null } {
  return { userIds: [startedBy], groupId: REVIEW_GROUP_REASONS.has(reason) ? reviewGroupId : null };
}

/** `use_current` cần output; lý do nhóm + mất quyền/khoá luôn cho (dùng bản nháp ghép / bỏ qua stage). */
export const FORCE_USE_CURRENT: ReadonlySet<DecisionReason> = new Set<DecisionReason>([
  "team_calls",
  "team_tokens",
  "team_time",
  "team_no_change",
  "permission_lost",
  "user_inactive",
]);

/** Lựa chọn của task `decision` (team-runner, sweeps, view D9 dùng chung). */
export const decisionOptionsFor = (hasOutput: boolean, reason: DecisionReason): DecisionOption[] =>
  isAutofixReason(reason)
    ? ["add_attempt", "cancel"] // P-c1 · PC-R10: không `use_current` kể cả có output
    : DECISION_OPTION_ORDER.filter(
        (o) => o !== "use_current" || hasOutput || FORCE_USE_CURRENT.has(reason),
      );
