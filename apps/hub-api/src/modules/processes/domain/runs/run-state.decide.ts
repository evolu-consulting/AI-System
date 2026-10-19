// HUB-FR-110 · PD-R04 · PD-R14 · PC-R10 · PC2-R08 · phần `decide` (Quyết định của người) của máy trạng thái
// process_run — tách khỏi `run-state.rules.ts` để giữ trần 150 dòng lớp domain (PD-A03). Thuần, lớp 1.
import type { DecisionOption } from "../types";
import { advance, BAD, end, ok, redo, withStage } from "./run-state.core";
import type { RunState, Transition } from "./run-state.types";

/** M5 · `add_attempt` nới đúng giới hạn theo lý do. */
function onAddAttempt(s: RunState): Transition {
  const reason = s.decisionReason;
  if (reason === "ask_limit")
    return ok(
      withStage(s, { status: "queued", askLimit: s.stage.askLimit + 1 }, { status: "running" }),
      ["queue_stage"],
    );
  // D-PD04 · `retry_exhausted`/`timer_invalid` giữ `attempt` (không phải làm lại do góp ý); retry còn reset bộ đếm.
  if (reason === "retry_exhausted" || reason === "timer_invalid")
    return ok(
      withStage(s, { status: "queued" }, { status: "running" }),
      reason === "retry_exhausted" ? ["queue_stage", "reset_retry"] : ["queue_stage"],
    );
  const attempt = s.stage.attempt + 1;
  return redo(s, {
    attemptLimit: Math.max(s.stage.attemptLimit + (reason === "redo_limit" ? 1 : 0), attempt),
  });
}

/** M5 · `add_attempt` (xem `onAddAttempt`); `use_current` cần output (trừ `timer_invalid`). */
export function onDecide(s: RunState, option: DecisionOption): Transition {
  const reason = s.decisionReason;
  if (option === "cancel") return end(s, "cancelled");
  if (option === "add_attempt") return onAddAttempt(s);
  // P-c1 · PC-R10 · P-c2 · PC2-R08 · `autofix_*`/`apply_*` chỉ add_attempt/cancel ⇒ `use_current` 409 PROCESS_RUN_STATE
  // (kể cả có output cũ): không có bản sửa/PR hợp lệ để "dùng hiện tại".
  if (
    reason === "autofix_check_failed" ||
    reason === "sandbox_unavailable" ||
    reason === "apply_conflict" ||
    reason === "apply_failed"
  )
    return BAD;
  // D-PD05 · `timer_invalid` + `use_current` không cần output (stage `wait_until` luôn `after: auto`, PD-R17).
  if (reason === "timer_invalid") return advance(s, ["write_wait_skip"]);
  if (!s.stage.hasOutput) return { ok: false, code: "NO_OUTPUT" };
  // P-b2 D8 · `back_limit` + `use_current` ⇒ stage nguồn coi Đạt như `redo_limit` (`add_attempt` do gates/back.effects).
  if (reason === "redo_limit" || reason === "back_limit") return advance(s, ["close_open_tasks"]);
  if (s.stage.after === "auto") return advance(s);
  return ok(withStage(s, { status: "waiting_review" }, { status: "waiting_review" }), [
    "open_review",
  ]);
}
