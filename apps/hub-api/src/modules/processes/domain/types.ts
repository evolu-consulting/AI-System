// HUB-FR-143…145 · CA-R04 · plan-domain §1: kiểu domain quy trình TỰ KHAI (lớp 1 không import contract). Union chuỗi =
// mảng contract — `adapters/processes.mapper.test.ts` khẳng định bằng `AssertEqual`; contract đổi ⇒ mapper đỏ trước.
export type ProcessRunStatus =
  | "running"
  | "waiting_review"
  | "waiting_answer"
  | "needs_decision"
  | "done"
  | "cancelled"
  | "failed"
  | "expired"
  | "waiting_timer";
export type StageRunStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_answer"
  | "waiting_review"
  | "needs_decision"
  | "done"
  | "cancelled"
  | "failed"
  | "waiting_timer"; // P-d2 (T17) + "skipped"
export type DecisionReason =
  | "redo_limit"
  | "ask_limit"
  | "template_invalid"
  | "team_calls"
  | "team_tokens"
  | "team_time"
  | "team_no_change"
  | "job_timeout"
  | "stage_tokens"
  | "run_tokens"
  | "agent_failed"
  | "permission_lost"
  | "user_inactive"
  | "interrupted"
  | "source_unresolvable"
  | "back_limit"
  | "autofix_check_failed"
  | "sandbox_unavailable"
  | "apply_conflict"
  | "apply_failed"
  | "retry_exhausted"
  | "timer_invalid"; // P-d2 + "tool_failed"
export type TeamRunStatus =
  | "running"
  | "waiting_answer"
  | "done"
  | "limit"
  | "failed"
  | "cancelled";
export type TaskKind = "review" | "ask" | "decision";
export type TaskStatus = "open" | "closed";
export type DecisionOption = "add_attempt" | "use_current" | "cancel";
export type ExecutorKind = "agent" | "team" | "apply" | "wait_until"; // P-d2 + "tool"
export type TimerKind = "wait_until" | "retry";
export type InputType = "text" | "select" | "file" | "source_ref" | "date";
export type NoticeKind =
  | "review_requested"
  | "ask_requested"
  | "decision_requested"
  | "reminder"
  | "task_closed"
  | "run_finished"
  | "escalated";

/** Con trỏ hẹn giờ (đọc từ repo; `Date` thay chuỗi ISO — mapper/repo chuyển). */
export type Timer = {
  id: string;
  tenantId: string;
  runId: string;
  stageRunId: string;
  kind: TimerKind;
  dueAt: Date;
  firedAt: Date | null;
  cancelledAt: Date | null;
};
