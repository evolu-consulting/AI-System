// HUB-FR-106 · HUB-FR-107 · HUB-FR-110 · HUB-FR-115 · AC-H28 · máy trạng thái process_run + stage hiện tại (plan §3.1–3.2,
// plan-contract §7). Thuần: trả trạng thái kế + hiệu ứng (người gọi thực thi trong tx, thứ tự khoá plan §10).
import {
  ASKS_MAX,
  type DecisionOption,
  type DecisionReason,
  type ProcessRunStatus,
  REDO_MAX,
  type StageRunStatus,
} from "@ai/contracts/chat";

export type RunEvent =
  | { kind: "stage_output"; templateOk: boolean }
  | { kind: "need_input" }
  | { kind: "limit"; reason: DecisionReason }
  | { kind: "review"; result: "pass" | "fail" }
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
  | "finish_run";
export type Transition =
  | { ok: true; next: RunState; effects: Effect[] }
  | { ok: false; code: "PROCESS_RUN_STATE" | "NO_OUTPUT" };

const TERMINAL: ReadonlySet<ProcessRunStatus> = new Set(["done", "cancelled", "failed", "expired"]);
export const isTerminal = (s: ProcessRunStatus): boolean => TERMINAL.has(s);

const BAD: Transition = { ok: false, code: "PROCESS_RUN_STATE" };
const ok = (next: RunState, effects: Effect[]): Transition => ({ ok: true, next, effects });

/** Lần thử 1 + làm lại ≤ `REDO_MAX`; hỏi lại ≤ `ASKS_MAX` (mặc định stage kế; `decide add_attempt` nới). */
const DEFAULT_ATTEMPT_LIMIT = REDO_MAX + 1;

const withStage = (s: RunState, stage: Partial<StageState>, run: Partial<RunState> = {}) => ({
  ...s,
  decisionReason: null,
  ...run,
  stage: { ...s.stage, ...stage },
});

/** Stage hiện tại xong: stage kế `queued` (running) hoặc run `done`. */
function advance(s: RunState, extra: Effect[] = []): Transition {
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

const needsDecision = (s: RunState, reason: DecisionReason): Transition =>
  ok(
    withStage(
      s,
      { status: "needs_decision" },
      { status: "needs_decision", decisionReason: reason },
    ),
    ["open_decision"],
  );

/** Cùng stage chạy lại (attempt + 1). */
const redo = (s: RunState, stage: Partial<StageState> = {}): Transition =>
  ok(
    withStage(
      s,
      { status: "queued", attempt: s.stage.attempt + 1, ...stage },
      { status: "running" },
    ),
    ["queue_stage"],
  );

function end(s: RunState, status: "cancelled" | "expired"): Transition {
  const next = withStage(s, { status: "cancelled" }, { status });
  return ok(next, ["cancel_stage_run", "close_open_tasks", "finish_run"]);
}

function onOutput(s: RunState, templateOk: boolean): Transition {
  if (!templateOk)
    return s.stage.attempt < s.stage.attemptLimit ? redo(s) : needsDecision(s, "template_invalid");
  const done = { ...s, stage: { ...s.stage, hasOutput: true } };
  if (s.stage.after === "auto") return advance(done);
  return ok(withStage(done, { status: "waiting_review" }, { status: "waiting_review" }), [
    "open_review",
  ]);
}

function onNeedInput(s: RunState): Transition {
  // D4 · stage "Hành động thật" không được hỏi người bắt đầu (sẽ lách cổng duyệt) ⇒ cần người quyết.
  if (s.stage.realAction === true) return needsDecision(s, "permission_lost");
  if (s.stage.asksCount >= s.stage.askLimit) return needsDecision(s, "ask_limit");
  const stage = { status: "waiting_answer" as const, asksCount: s.stage.asksCount + 1 };
  return ok(withStage(s, stage, { status: "waiting_answer" }), ["open_ask"]);
}

function onReview(s: RunState, result: "pass" | "fail"): Transition {
  if (result === "pass") return advance(s, ["close_open_tasks"]);
  return s.stage.attempt < s.stage.attemptLimit ? redo(s) : needsDecision(s, "redo_limit");
}

/** M5 · `add_attempt` nới đúng giới hạn theo lý do; `use_current` cần output. */
function onDecide(s: RunState, option: DecisionOption): Transition {
  const reason = s.decisionReason;
  if (option === "cancel") return end(s, "cancelled");
  if (option === "add_attempt") {
    if (reason === "ask_limit")
      return ok(
        withStage(s, { status: "queued", askLimit: s.stage.askLimit + 1 }, { status: "running" }),
        ["queue_stage"],
      );
    const attempt = s.stage.attempt + 1;
    return redo(s, {
      attemptLimit: Math.max(s.stage.attemptLimit + (reason === "redo_limit" ? 1 : 0), attempt),
    });
  }
  if (!s.stage.hasOutput) return { ok: false, code: "NO_OUTPUT" };
  // P-b2 D8 · `back_limit` + `use_current` ⇒ stage nguồn coi Đạt như `redo_limit` (`add_attempt` do gates/back.effects).
  if (reason === "redo_limit" || reason === "back_limit") return advance(s, ["close_open_tasks"]);
  if (s.stage.after === "auto") return advance(s);
  return ok(withStage(s, { status: "waiting_review" }, { status: "waiting_review" }), [
    "open_review",
  ]);
}

/** Trạng thái hiện tại phải nhận sự kiện; sai ⇒ `PROCESS_RUN_STATE` (409). */
const ACCEPTS: Record<RunEvent["kind"], ProcessRunStatus | "active"> = {
  stage_output: "running",
  need_input: "running",
  limit: "running",
  permission_lost: "running",
  user_inactive: "running",
  interrupted: "running",
  review: "waiting_review",
  answer: "waiting_answer",
  decide: "needs_decision",
  cancel: "active",
  expire: "active",
};

export function transition(s: RunState, e: RunEvent): Transition {
  if (isTerminal(s.status)) return BAD;
  const want = ACCEPTS[e.kind];
  if (want !== "active" && want !== s.status) return BAD;
  switch (e.kind) {
    case "stage_output":
      return onOutput(s, e.templateOk);
    case "need_input":
      return onNeedInput(s);
    case "limit":
      return needsDecision(s, e.reason);
    case "review":
      return onReview(s, e.result);
    case "answer":
      return ok(withStage(s, { status: "queued" }, { status: "running" }), ["queue_stage"]);
    case "decide":
      return onDecide(s, e.option);
    case "cancel":
      return end(s, "cancelled");
    case "expire":
      return end(s, "expired");
    default:
      return needsDecision(s, e.kind);
  }
}
