// HUB-NFR-02 · vòng nền định kỳ của instance (lease, sweeper lease, quét orphan — plan H1 §5.2, §5.5, §5.8).
// Không chồng lượt (lượt trước chưa xong → bỏ nhịp), lỗi một lượt chỉ log; dừng hẳn khi `signal` abort (QW-A2).
import { safeErrorFields } from "./errors";
import type { Logger } from "./logger";

export type LoopOptions = {
  /** Tên trong log (`<name>-failed`). */
  name: string;
  everyMs: number;
  tick: () => Promise<unknown>;
  log: Logger;
  signal?: AbortSignal;
};

export function startLoop(o: LoopOptions): void {
  if (o.signal?.aborted) return;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || o.signal?.aborted) return;
    busy = true;
    try {
      await o.tick();
    } catch (err) {
      if (!o.signal?.aborted) o.log.warn(`${o.name}-failed`, safeErrorFields(err));
    } finally {
      busy = false;
    }
  }, o.everyMs);
  // Không giữ tiến trình sống chỉ vì vòng nền (server giữ bằng cổng nghe).
  timer.unref?.();
  o.signal?.addEventListener("abort", () => clearInterval(timer), { once: true });
}
