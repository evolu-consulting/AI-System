// HUB-FR-106 · HUB-FR-107 · HUB-FR-110 · HUB-FR-115 · AC-H28 · kiểu của máy trạng thái process_run (tách khỏi
// `run-state.rules.ts` để giữ trần 150 dòng lớp domain, PD-A03). Lớp 1: kiểu ⇐ `../types`.
import type { DecisionOption, DecisionReason, ProcessRunStatus, StageRunStatus } from "../types";

export type RunEvent =
  | { kind: "stage_output"; templateOk: boolean }
  | { kind: "need_input" }
  | { kind: "limit"; reason: DecisionReason }
  /** N2-FR-02 · `reject` = Từ chối ⇒ kết thúc run `cancelled` (khác `fail` = làm lại). */
  | { kind: "review"; result: "pass" | "fail" | "reject" }
  | { kind: "answer" }
  | { kind: "decide"; option: DecisionOption }
  | { kind: "cancel" }
  | { kind: "expire" }
  | { kind: "permission_lost" | "user_inactive" | "interrupted" };

export type StageState = {
  status: StageRunStatus;
  attempt: number;
  attemptLimit: number;
  asksCount: number;
  askLimit: number;
  after: "review" | "auto";
  hasOutput: boolean;
  /** D4 · HUB-FR-109 · stage "Hành động thật": `need_input` ⇒ needs_decision (người bắt đầu không được tự xác nhận hành
   * động thật — phải qua người quyết; chống def "lách luật" real_action sau stage auto, P1-62). */
  realAction?: boolean;
};
export type RunState = {
  status: ProcessRunStatus;
  stageIdx: number;
  stageCount: number;
  stage: StageState;
  decisionReason: DecisionReason | null;
};
export type Effect =
  | "queue_stage"
  | "queue_next_stage"
  | "open_review"
  | "open_ask"
  | "open_decision"
  | "close_open_tasks"
  | "cancel_stage_run"
  | "finish_run"
  /** PD-R04 · `add_attempt` của `retry_exhausted`: `retry_count = 0`, `last_error_code = NULL` (giữ `retry_since`). */
  | "reset_retry"
  /** PD-R14 · `use_current` của `timer_invalid`: ghi .md "Bỏ chờ theo quyết định" trước khi advance (T8 thực thi). */
  | "write_wait_skip";
export type Transition =
  | { ok: true; next: RunState; effects: Effect[] }
  | { ok: false; code: "PROCESS_RUN_STATE" | "NO_OUTPUT" };
