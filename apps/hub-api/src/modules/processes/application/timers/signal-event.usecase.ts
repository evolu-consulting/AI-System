// CR-120 · G4 · use case lớp 2: gói bắn sự kiện `event` cho MỘT run (tx `system(tenantId)` của người gọi). Thứ tự khoá run → stage →
// timer. Luôn ghi sự kiện (gói bắn trước khi run tới bước chờ ⇒ `enterTimedWait` thấy `already`); stage `wait_event` đang chờ đúng khoá
// ⇒ huỷ hẹn hạn + `finishWait` (stage `done`, join bước, kick qua outbox). Run đã kết thúc / không thấy ⇒ `no_run` (không ghi).
import { isTerminal } from "../../domain/runs/run-state.rules";
import type { TxRepos } from "../ports";

export type SignalRepos = Pick<TxRepos, "runs" | "timers" | "stageTimers" | "runEvents">;
/** `released` = số stage chờ vừa được thả; 0 ⇒ chỉ ghi sự kiện (chưa tới bước chờ). */
export type SignalOutcome = { kind: "no_run" } | { kind: "ok"; released: number };

export async function signalEvent(
  r: SignalRepos,
  i: { runId: string; event: string; now: Date; timezone?: string },
): Promise<SignalOutcome> {
  const run = await r.runs.lock(i.runId);
  if (!run || isTerminal(run.status)) return { kind: "no_run" };
  await r.runEvents.record(i.runId, i.event, i.now);
  const stages = await r.runEvents.waitingStages(i.runId, i.event);
  let released = 0;
  for (const stageRunId of stages) {
    const stage = await r.stageTimers.lockStage(i.runId, stageRunId);
    if (stage?.status !== "waiting_timer") continue;
    await r.timers.cancelForRun(i.runId, [stageRunId], i.now);
    await r.stageTimers.finishWait(i.runId, stageRunId, {
      dueAt: i.now,
      timezone: i.timezone ?? "UTC",
    });
    released++;
  }
  return { kind: "ok", released };
}
