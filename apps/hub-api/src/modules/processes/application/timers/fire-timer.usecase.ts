// HUB-FR-143 · HUB-FR-144 · HUB-BR-42 · PD-R11/R15 · plan §4.6 (Bắn), §5–§6 · use case lớp 2: bắn MỘT hẹn tới hạn trong tx
// `system(tenantId)` của người gọi. Thứ tự khoá run → stage → timer (không đường nào khoá timer trước run); kiểm lại
// chưa bắn/chưa huỷ SAU khoá (hai instance cùng quét ⇒ một lần bắn, S4). Hành động theo `fireAction` (timer.rules).
// Chỉ biết port (không `Tx`); kick/sự kiện qua outbox ⇒ phát SAU COMMIT.
import { isTerminal } from "../../domain/runs/run-state.rules";
import { fireAction } from "../../domain/timers/timer.rules";
import type { TxRepos } from "../ports";

/** Ứng viên đọc không khoá ở vòng quét (cột bất biến của hàng hẹn). */
export type FireCandidate = { id: string; runId: string; stageRunId: string };
/** `fired` ⇒ đã đặt `fired_at` + áp hiệu ứng; `dropped` ⇒ stage đã đổi/run kết thúc ⇒ hẹn `cancelled_at`; `skipped` ⇒ bỏ. */
export type FireOutcome = "fired" | "dropped" | "skipped";

export type FireRepos = Pick<TxRepos, "runs" | "timers" | "stageTimers" | "kicker">;

export async function fireTimer(r: FireRepos, c: FireCandidate, now: Date): Promise<FireOutcome> {
  const run = await r.runs.lock(c.runId);
  if (!run) return "skipped";
  const stage = await r.stageTimers.lockStage(c.runId, c.stageRunId);
  const t = await r.timers.lockById(c.id);
  if (!t || t.runId !== c.runId || t.stageRunId !== c.stageRunId) return "skipped";
  if (t.firedAt !== null || t.cancelledAt !== null) return "skipped";
  const act = fireAction(t.kind, stage?.status ?? "cancelled", isTerminal(run.status));
  if (act.kind === "drop") {
    await r.timers.cancelForRun(c.runId, [c.stageRunId], now);
    return "dropped";
  }
  if (!(await r.timers.markFired(t.id, now))) return "skipped";
  if (act.kind === "requeue") {
    await r.stageTimers.requeue(c.runId, c.stageRunId, now);
    r.kicker.kick(c.runId);
    return "fired";
  }
  const timezone = (await r.stageTimers.timezoneOf(t.id)) ?? "UTC";
  await r.stageTimers.finishWait(c.runId, c.stageRunId, { dueAt: t.dueAt, timezone });
  return "fired";
}
