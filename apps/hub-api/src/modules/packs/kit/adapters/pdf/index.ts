// ADR-0028 (khuôn ADR-0024 §3): `PdfConverter` chạy trong 1 Bun Worker, hàng đợi RAM. Vượt `maxPending` (đang chạy + chờ) hoặc
// tenant đã có việc chờ ⇒ `PDF_BUSY` ngay; đầu vào > `PDF_MAX_INPUT` ⇒ `PDF_TOO_LARGE` trước khi vào worker. Chờ kết quả bằng
// tín hiệu `message`; `timeoutMs` chỉ là lưới an toàn (Luật 4c): hết giờ / worker lỗi ⇒ `terminate()`, `PDF_UNREADABLE`, worker
// mới dựng lười ở việc kế. Không ném. (Cùng hình `DocxQueue` — gộp hàng đợi chung: TECH-DEBT.)
import { canQueueDocx } from "../../domain/docx.rules";
import {
  PDF_MAX_INPUT,
  type PdfConverter,
  type PdfRequestOpts,
  type PdfResult,
} from "../../domain/pdf.rules";

export type PdfConverterOptions = { maxPending?: number; timeoutMs?: number };

const UNREADABLE: PdfResult = { ok: false, code: "PDF_UNREADABLE" };
const BUSY: PdfResult = { ok: false, code: "PDF_BUSY" };
const TOO_LARGE: PdfResult = { ok: false, code: "PDF_TOO_LARGE" };

type Job = { bytes: Uint8Array; tenantId?: string; resolve: (r: PdfResult) => void };
type Running = Job & { id: number; timer: ReturnType<typeof setTimeout> };
type BunWorker = Worker & { ref(): void; unref(): void };

class PdfQueue {
  private readonly queue: Job[] = [];
  private worker: BunWorker | null = null;
  private running: Running | null = null;
  private seq = 0;
  private closed = false;

  constructor(
    private readonly maxPending: number,
    private readonly timeoutMs: number,
  ) {}

  submit(bytes: Uint8Array, tenantId?: string): Promise<PdfResult> {
    if (bytes.byteLength > PDF_MAX_INPUT) return Promise.resolve(TOO_LARGE);
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
    this.worker?.terminate();
    this.worker = null;
  }

  private finish(id: number, r: PdfResult, crashed = false): void {
    const job = this.running;
    if (!job || job.id !== id) return;
    clearTimeout(job.timer);
    this.running = null;
    if (crashed) {
      this.worker?.terminate();
      this.worker = null;
    }
    job.resolve(r);
    this.pump();
  }

  private spawn(): BunWorker {
    const w = new Worker(new URL("./pdf.worker.ts", import.meta.url).href) as BunWorker;
    w.onmessage = (ev: MessageEvent<{ id: number; result: PdfResult }>) =>
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
    const copy = job.bytes.slice();
    this.worker.postMessage({ id, bytes: copy }, [copy.buffer]);
  }
}

/** PDF lớn hơn DOCX nhiều lần về thời gian đọc ⇒ lưới an toàn 30 s (không phải cơ chế chờ). */
export function createPdfConverter(
  opts: PdfConverterOptions = {},
): PdfConverter & { close(): Promise<void> } {
  const q = new PdfQueue(Math.max(1, opts.maxPending ?? 2), opts.timeoutMs ?? 30_000);
  return {
    toText: (bytes: Uint8Array, o?: PdfRequestOpts) => q.submit(bytes, o?.tenantId),
    close: async () => q.close(),
  };
}
