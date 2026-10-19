// HUB-FR-106 · HUB-FR-107 · HUB-FR-110 · HUB-FR-115 · AC-H28 · máy trạng thái process_run + stage hiện tại (plan §3.1–3.2,
// plan-contract §7). Thuần: trả trạng thái kế + hiệu ứng (người gọi thực thi trong tx, thứ tự khoá plan §10).
// HUB-FR-143 · CA-R03/R04 · ADR-0023 · lớp 1: hằng ⇐ `../limits`, kiểu ⇐ `../types` (không import contract).
// PD-A03: kiểu ở `run-state.types.ts`, phép dựng ở `run-state.core.ts`, nhánh `decide` ở `run-state.decide.ts`.
import type { ProcessRunStatus } from "../types";
import {
  advance,
  BAD,
  end,
  isTerminal,
  needsDecision,
  ok,
  redo,
  withStage,
} from "./run-state.core";
import { onDecide } from "./run-state.decide";
import type { RunEvent, RunState, Transition } from "./run-state.types";

export type { Effect, RunEvent, RunState, StageState, Transition } from "./run-state.types";
export { isTerminal };

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

function onReview(s: RunState, result: "pass" | "fail" | "reject"): Transition {
  if (result === "pass") return advance(s, ["close_open_tasks"]);
  if (result === "reject") return end(s, "cancelled");
  return s.stage.attempt < s.stage.attemptLimit ? redo(s) : needsDecision(s, "redo_limit");
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
