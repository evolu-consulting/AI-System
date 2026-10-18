// HUB-FR-112 · HUB-FR-145 · AC-H32 · AC-H42 · PF3 · CR-093 · plan §5 (vòng "Nhắc + chuyển cấp") · plan-addendum A9/A10:
// runner lớp 4 — `remindOnce` = MỘT lượt xả qua use case `remindTasks` (`sysUow.systemBatch`, theo tập), vòng nền
// `startProcessReminder` 300 s (`lib/loop.ts` chặn chồng lượt). Đồng hồ = seam `d.now`.
import { startLoop } from "../../../lib/loop";
import { remindTasks } from "../application/notify/remind-tasks.usecase";
import type { ProcessBgDeps } from "../core/ports";

/** D-PD10 · nhịp vòng nhắc + chuyển cấp. */
export const PROCESS_REMIND_EVERY_MS = 300_000;

/** Một lượt nhắc + chuyển cấp: trả tổng số task vừa nhắc (mọi lô). Test gọi qua `ProcessHandles.remindOnce`. */
export function remindOnce(d: ProcessBgDeps): Promise<number> {
  return remindTasks({ sysUow: d.sysUow, now: d.now, elapsedMs: () => performance.now() });
}

/** Mount gọi khi `processLoops !== false`; `signal` abort ⇒ dừng. Lỗi một lượt chỉ log. */
export function startProcessReminder(
  d: ProcessBgDeps,
  o: { everyMs?: number; signal?: AbortSignal } = {},
): void {
  startLoop({
    name: "process-remind",
    everyMs: o.everyMs ?? PROCESS_REMIND_EVERY_MS,
    tick: () => remindOnce(d),
    log: d.log,
    signal: o.signal,
  });
}
