// CR-127 · E10 · spec §5.9 · #54 · vòng nền `task-signal`: đóng việc nhóm theo tín hiệu gói ghi (`hub.task_signals`) — lô `SKIP LOCKED`,
// mỗi lô một tx riêng (adapters/milestone-task.repo.ts). Test gọi `ProcessHandles.taskSignalOnce` (không ngủ chờ).
import { startLoop } from "../../../lib/loop";
import { taskSignalBatch } from "../adapters/milestone-task.repo";
import type { ProcessBgDeps } from "../core/ports";

export const TASK_SIGNAL_EVERY_MS = 30_000;
const DRAIN_BUDGET_MS = 10_000;

/** Một lượt: xử lý tới hết tín hiệu chờ (hoặc hết ngân sách). Trả số tín hiệu đã xử lý. */
export async function taskSignalOnce(d: ProcessBgDeps): Promise<number> {
  const t0 = performance.now();
  let total = 0;
  for (;;) {
    const b = await taskSignalBatch(d.db, d.now());
    total += b.n;
    if (!b.more || performance.now() - t0 >= DRAIN_BUDGET_MS) return total;
  }
}

export function startTaskSignal(d: ProcessBgDeps, o: { signal?: AbortSignal } = {}): void {
  startLoop({
    name: "task-signal",
    everyMs: TASK_SIGNAL_EVERY_MS,
    tick: () => taskSignalOnce(d),
    log: d.log,
    signal: o.signal,
  });
}
