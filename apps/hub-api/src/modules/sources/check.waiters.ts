// HUB-FR-120 · PB-R05 · C13 · "Kiểm tra kết nối" chờ đồng bộ: check.service đăng ký chờ theo `job_id`; route
// `/sources-resolved` (Runtime báo) đánh thức. Hết `sourceCheckTimeoutMs` ⇒ `timeout` (⇒ 422 SOURCE_UNRESOLVABLE).
import type { SourcePin } from "@ai/contracts/hub-admin";

export type ResolveOutcome =
  | { kind: "ok"; pin: SourcePin; files: number; bytes: number }
  | { kind: "error"; code: string }
  | { kind: "timeout" };

export class CheckWaiters {
  readonly #map = new Map<string, (o: ResolveOutcome) => void>();

  wait(jobId: string, timeoutMs: number): Promise<ResolveOutcome> {
    return new Promise<ResolveOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.#map.delete(jobId);
        resolve({ kind: "timeout" });
      }, timeoutMs);
      this.#map.set(jobId, (o) => {
        clearTimeout(timer);
        this.#map.delete(jobId);
        resolve(o);
      });
    });
  }

  /** Trả true nếu có người chờ (check đồng bộ); false = report của run (S3) hoặc đã timeout. */
  settle(jobId: string, outcome: ResolveOutcome): boolean {
    const w = this.#map.get(jobId);
    if (!w) return false;
    w(outcome);
    return true;
  }
}
