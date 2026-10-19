// PK-FR-07 · PK-NFR-02 · plan §7 · ADR-0024 §3: `DocxConverter` chạy trong 1 Bun Worker, hàng đợi RAM. Việc vượt `maxPending`
// (đang chạy + đang chờ) hoặc tenant đã có việc đang chờ (review m-03) ⇒ `DOCX_BUSY` ngay; đầu vào > `DOCX_MAX_INPUT` ⇒
// `DOCX_UNREADABLE` trước khi vào worker. Chờ kết quả bằng tín hiệu `message` của worker; `timeoutMs` chỉ là lưới an toàn
// (Luật 4c): hết giờ / worker lỗi ⇒ `terminate()`, trả `DOCX_UNREADABLE`, worker mới dựng lười ở việc kế. Không ném.
import {
  canQueueDocx,
  DOCX_MAX_INPUT,
  type DocxConverter,
  type DocxRequestOpts,
  type DocxResult,
} from "../../domain/docx.rules";

export type DocxConverterOptions = { maxPending?: number; timeoutMs?: number };

const UNREADABLE: DocxResult = { ok: false, code: "DOCX_UNREADABLE" };
const BUSY: DocxResult = { ok: false, code: "DOCX_BUSY" };

type Job = { bytes: Uint8Array; tenantId?: string; resolve: (r: DocxResult) => void };
type Running = Job & { id: number; timer: ReturnType<typeof setTimeout> };
/** Bun Worker có `ref`/`unref`; lib DOM (tsconfig.tests) thì không. */
type BunWorker = Worker & { ref(): void; unref(): void };

/** Hàng đợi + 1 worker (review M-01: tách khỏi `createDocxConverter`). */
class DocxQueue {
  private readonly queue: Job[] = [];
  private worker: BunWorker | null = null;
  private running: Running | null = null;
  private seq = 0;
  private closed = false;
  private readonly maxPending: number;
  private readonly timeoutMs: number;

  constructor(maxPending: number, timeoutMs: number) {
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
  }

  submit(bytes: Uint8Array, tenantId?: string): Promise<DocxResult> {
    if (bytes.byteLength > DOCX_MAX_INPUT) return Promise.resolve(UNREADABLE);
    const state = {
      total: this.queue.length + (this.running ? 1 : 0),
      waitingTenants: this.queue.map((j) => j.tenantId),
    };
    if (this.closed || !canQueueDocx(state, this.maxPending, tenantId))
      return Promise.resolve(BUSY);
    return new Promise((resolve) => {
      this.queue.push({ bytes, tenantId, resolve });
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    if (this.running) {
      clearTimeout(this.running.timer);
      this.running.resolve(BUSY);
      this.running = null;
    }
    for (const j of this.queue.splice(0)) j.resolve(BUSY);
    this.kill();
  }

  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private finish(id: number, r: DocxResult, crashed = false): void {
    const job = this.running;
    if (!job || job.id !== id) return;
    clearTimeout(job.timer);
    this.running = null;
    if (crashed) this.kill();
    job.resolve(r);
    this.pump();
  }

  private spawn(): BunWorker {
    const w = new Worker(new URL("./docx.worker.ts", import.meta.url).href) as BunWorker;
    w.onmessage = (ev: MessageEvent<{ id: number; result: DocxResult }>) =>
      this.finish(ev.data.id, ev.data.result);
    w.onerror = () => this.running && this.finish(this.running.id, UNREADABLE, true);
    return w;
  }

  private pump(): void {
    const job = this.running || this.closed ? undefined : this.queue.shift();
    if (!job) {
      if (!this.running) this.worker?.unref();
      return;
    }
    this.worker ??= this.spawn();
    this.worker.ref();
    const id = ++this.seq;
    const timer = setTimeout(() => this.finish(id, UNREADABLE, true), this.timeoutMs);
    this.running = { ...job, id, timer };
    const copy = job.bytes.slice(); // bản riêng ⇒ chuyển quyền buffer, không làm hỏng mảng của người gọi
    this.worker.postMessage({ id, bytes: copy }, [copy.buffer]);
  }
}

export function createDocxConverter(
  opts: DocxConverterOptions = {},
): DocxConverter & { close(): Promise<void> } {
  const q = new DocxQueue(Math.max(1, opts.maxPending ?? 2), opts.timeoutMs ?? 10_000);
  return {
    toMarkdown: (bytes: Uint8Array, o?: DocxRequestOpts) => q.submit(bytes, o?.tenantId),
    close: async () => q.close(),
  };
}
