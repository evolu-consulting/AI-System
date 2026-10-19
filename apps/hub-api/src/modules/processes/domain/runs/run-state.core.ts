// HUB-FR-106 · HUB-FR-107 · AC-H28 · phép dựng chuyển trạng thái dùng chung của `run-state.rules.ts` và
// `run-state.decide.ts` (tách để giữ trần 150 dòng lớp domain, PD-A03). Thuần, lớp 1.
import { ASKS_MAX, REDO_MAX } from "../limits";
import type { DecisionReason, ProcessRunStatus } from "../types";
import type { Effect, RunState, StageState, Transition } from "./run-state.types";

const TERMINAL: ReadonlySet<ProcessRunStatus> = new Set(["done", "cancelled", "failed", "expired"]);
export const isTerminal = (s: ProcessRunStatus): boolean => TERMINAL.has(s);

export const BAD: Transition = { ok: false, code: "PROCESS_RUN_STATE" };
export const ok = (next: RunState, effects: Effect[]): Transition => ({ ok: true, next, effects });

/** Lần thử 1 + làm lại ≤ `REDO_MAX`; hỏi lại ≤ `ASKS_MAX` (mặc định stage kế; `decide add_attempt` nới). */
const DEFAULT_ATTEMPT_LIMIT = REDO_MAX + 1;

export const withStage = (
  s: RunState,
  stage: Partial<StageState>,
  run: Partial<RunState> = {},
) => ({
  ...s,
  decisionReason: null,
  ...run,
  stage: { ...s.stage, ...stage },
});

/** Stage hiện tại xong: stage kế `queued` (running) hoặc run `done`. */
export function advance(s: RunState, extra: Effect[] = []): Transition {
  if (s.stageIdx + 1 >= s.stageCount)
    return ok(withStage(s, { status: "done" }, { status: "done" }), [...extra, "finish_run"]);
  const stage: StageState = {
    ...s.stage,
    status: "queued",
    attempt: 1,
    attemptLimit: DEFAULT_ATTEMPT_LIMIT,
    asksCount: 0,
    askLimit: ASKS_MAX,
    hasOutput: false,
  };
  const next = {
    ...s,
    status: "running" as const,
    stageIdx: s.stageIdx + 1,
    stage,
    decisionReason: null,
  };
  return ok(next, [...extra, "queue_next_stage"]);
}

export const needsDecision = (s: RunState, reason: DecisionReason): Transition =>
  ok(
    withStage(
      s,
      { status: "needs_decision" },
      { status: "needs_decision", decisionReason: reason },
    ),
    ["open_decision"],
  );

/** Cùng stage chạy lại (attempt + 1). */
export const redo = (s: RunState, stage: Partial<StageState> = {}): Transition =>
  ok(
    withStage(
      s,
      { status: "queued", attempt: s.stage.attempt + 1, ...stage },
      { status: "running" },
    ),
    ["queue_stage"],
  );

export function end(s: RunState, status: "cancelled" | "expired"): Transition {
  const next = withStage(s, { status: "cancelled" }, { status });
  return ok(next, ["cancel_stage_run", "close_open_tasks", "finish_run"]);
}
