// HUB-FR-112 · HUB-FR-145 · AC-H32 · AC-H42 · PF3 · CR-093 · plan §5 (vòng "Nhắc + chuyển cấp") · plan-addendum A9/A10:
// runner lớp 4 — `remindOnce` = MỘT lượt xả qua use case `remindTasks` (`sysUow.systemBatch`, theo tập), vòng nền
// `startProcessReminder` 300 s (`lib/loop.ts` chặn chồng lượt). Đồng hồ = seam `d.now`.

import { probe } from "@ai/db/probe";
import { startLoop } from "../../../lib/loop";
import { releaseClaims } from "../application/notify/claim-release.usecase";
import { remindTasks } from "../application/notify/remind-tasks.usecase";
import type { ProcessBgDeps } from "../core/ports";
import { emitPackTaskEvents } from "../runs/pack-task-events";

/** D-PD10 · nhịp vòng nhắc + chuyển cấp. */
export const PROCESS_REMIND_EVERY_MS = 300_000;

/** Một lượt nhắc + chuyển cấp: trả tổng số task vừa nhắc (mọi lô). Test gọi qua `ProcessHandles.remindOnce`. */
export function remindOnce(d: ProcessBgDeps): Promise<number> {
  // CR-116 · điểm đo (tắt ⇒ gọi thẳng).
  return probe("remind.once", () =>
    remindTasks({
      sysUow: d.sysUow,
      now: d.now,
      elapsedMs: () => performance.now(),
      emit: (rows) => emitPackTaskEvents(d, rows), // [AUDIT] · chuyển cấp ⇒ lịch sử gói
    }),
  );
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

/** CR-127 · E2 · nhịp vòng tự trả việc đã nhận (giờ tự trả tính theo giờ ⇒ 5 phút đủ mịn). */
export const CLAIM_RELEASE_EVERY_MS = 300_000;

/** CR-127 · E2 · một lượt tự trả việc đã nhận quá hạn (mọi lô). Test gọi qua `ProcessHandles.claimReleaseOnce`. */
export function claimReleaseOnce(d: ProcessBgDeps): Promise<number> {
  return releaseClaims({
    sysUow: d.sysUow,
    now: d.now,
    elapsedMs: () => performance.now(),
    emit: (rows) => emitPackTaskEvents(d, rows), // [AUDIT] · tự trả việc ⇒ lịch sử gói
  });
}

export function startClaimRelease(d: ProcessBgDeps, o: { signal?: AbortSignal } = {}): void {
  startLoop({
    name: "claim-release",
    everyMs: CLAIM_RELEASE_EVERY_MS,
    tick: () => claimReleaseOnce(d),
    log: d.log,
    signal: o.signal,
  });
}
