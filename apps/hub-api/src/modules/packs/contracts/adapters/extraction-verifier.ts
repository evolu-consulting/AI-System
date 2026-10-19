// HD-FR-22 · ADR-0024 §3 · review HD2 Trung 1: cổng `ExtractionVerifier`. Văn bản ≤ `inlineMax` ký tự ⇒ chạy tại chỗ (≤ 5 ms ở
// 30.000 ký tự); lớn hơn (tới 5 MB) ⇒ một Bun Worker, hàng đợi RAM, chờ bằng tín hiệu `message`. `timeoutMs` chỉ là lưới an
// toàn: hết giờ / worker lỗi ⇒ `terminate()`, worker mới dựng lười ở việc kế, lượt đó ném (use case ⇒ `SAVE_FAILED`).
import type { ExtractionVerifier } from "../application/extraction.ports";
import { type VerifiedExtraction, verifyExtraction } from "../domain/extraction.rules";

type Input = Parameters<ExtractionVerifier["verify"]>[0];
type Job = Input & { resolve: (v: VerifiedExtraction) => void; reject: (e: Error) => void };
type Running = Job & { id: number; timer: ReturnType<typeof setTimeout> };
type BunWorker = Worker & { ref(): void; unref(): void };
type Reply = { id: number; result?: VerifiedExtraction; error?: true };

export type VerifierOptions = { inlineMax?: number; timeoutMs?: number };

/** Hàng đợi + 1 worker (khuôn `DocxQueue`). */
class VerifyQueue {
  private readonly queue: Job[] = [];
  private worker: BunWorker | null = null;
  private running: Running | null = null;
  private seq = 0;

  constructor(private readonly timeoutMs: number) {}

  submit(i: Input): Promise<VerifiedExtraction> {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...i, resolve, reject });
      this.pump();
    });
  }

  close(): void {
    for (const j of this.queue.splice(0)) j.reject(new Error("closed"));
    this.kill();
  }

  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  /** `r` null = hết giờ / worker hỏng ⇒ dựng lại worker ở việc kế. */
  private finish(id: number, r: Reply | null): void {
    const job = this.running;
    if (!job || job.id !== id) return;
    clearTimeout(job.timer);
    this.running = null;
    if (r?.result) job.resolve(r.result);
    else {
      if (!r) this.kill();
      job.reject(new Error("verify-worker-failed"));
    }
    this.pump();
  }

  private spawn(): BunWorker {
    const w = new Worker(new URL("./verify.worker.ts", import.meta.url).href) as BunWorker;
    w.onmessage = (ev: MessageEvent<Reply>) => this.finish(ev.data.id, ev.data);
    w.onerror = () => this.running && this.finish(this.running.id, null);
    return w;
  }

  private pump(): void {
    const job = this.running ? undefined : this.queue.shift();
    if (!job) {
      if (!this.running) this.worker?.unref();
      return;
    }
    this.worker ??= this.spawn();
    this.worker.ref();
    const id = ++this.seq;
    const timer = setTimeout(() => this.finish(id, null), this.timeoutMs);
    this.running = { ...job, id, timer };
    this.worker.postMessage({ id, raw: job.raw, source: job.source, kind: job.kind });
  }
}

export function createExtractionVerifier(o: VerifierOptions = {}): ExtractionVerifier & {
  close(): void;
} {
  const inlineMax = o.inlineMax ?? 200_000;
  const q = new VerifyQueue(o.timeoutMs ?? 60_000);
  return {
    verify: async (i) => ((i.source?.length ?? 0) <= inlineMax ? verifyExtraction(i) : q.submit(i)),
    close: () => q.close(),
  };
}
