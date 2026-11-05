// CR-120 · G3/G4 · use case lớp 2: stage `wait_for` (chờ N giờ) / `wait_event` (chờ sự kiện, hạn `timeout_h`) tới lượt ⇒ ghi stage
// `waiting_timer` + hẹn loại `wait_until` (dùng lại hẹn giờ: vòng quét bắn → `finishWait`). Không tính ngày theo múi giờ nên
// không bao giờ `invalid`. `wait_event` mà sự kiện ĐÃ tới (gói bắn trước khi run tới bước) ⇒ hẹn tới hạn NGAY (`due = now`):
// vòng quét kế tiếp bắn và `finishWait` thấy hàng sự kiện ⇒ ghi "Đã nhận". Chạy trong tx người gọi, run ĐÃ khoá; không `Tx`.
import { timerKey } from "../../domain/timers/timer-key.rules";
import type { RunEventRepo, TimerRepo } from "../ports";
import type { TenantTzReader, WaitRepo } from "./wait.ports";

export type TimedWaitRepos = {
  timers: Pick<TimerRepo, "countByStageKind" | "insert">;
  wait: Pick<WaitRepo, "markWaiting">;
  tz: TenantTzReader;
  events: Pick<RunEventRepo, "has">;
};

export type TimedWaitIn = {
  runId: string;
  stageRunId: string;
  round: number;
  attempt: number;
  /** `wait_for.hours` hoặc `wait_event.timeout_h`. */
  hours: number;
  /** Chỉ `wait_event`: khoá sự kiện — đã tới từ trước ⇒ hẹn tới hạn ngay. */
  event?: string;
  now: Date;
};

export type TimedWaitOut = { dueAt: Date; timezone: string; early: boolean };

export async function enterTimedWait(r: TimedWaitRepos, i: TimedWaitIn): Promise<TimedWaitOut> {
  const timezone = await r.tz.read();
  const early = i.event !== undefined && (await r.events.has(i.runId, i.event));
  const dueAt = early ? i.now : new Date(i.now.getTime() + i.hours * 3_600_000);
  // Thứ tự khoá plan §6: run (người gọi) → stage → timer.
  await r.wait.markWaiting(i.stageRunId, i.now);
  const n = (await r.timers.countByStageKind(i.stageRunId, "wait_until")) + 1;
  await r.timers.insert({
    runId: i.runId,
    stageRunId: i.stageRunId,
    kind: "wait_until",
    dueAt,
    key: timerKey({
      kind: "wait_until",
      stageRunId: i.stageRunId,
      round: i.round,
      attempt: i.attempt,
      n,
    }),
    timezone,
  });
  return { dueAt, timezone, early };
}
