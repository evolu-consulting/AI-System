// PK-FR-07 · PK-NFR-02 · plan §7 · ADR-0024 §3: `DocxConverter` chạy trong 1 Bun Worker, hàng đợi RAM. Việc vượt `maxPending`
// (đang chạy + đang chờ) ⇒ `DOCX_BUSY` ngay. Chờ kết quả bằng tín hiệu `message` của worker; `timeoutMs` chỉ là lưới an toàn
// (Luật 4c): hết giờ / worker lỗi ⇒ `terminate()`, trả `DOCX_UNREADABLE`, worker mới dựng lười ở việc kế. Không ném.
import type { DocxConverter, DocxResult } from "../../domain/docx.rules";

export type DocxConverterOptions = { maxPending?: number; timeoutMs?: number };

const UNREADABLE: DocxResult = { ok: false, code: "DOCX_UNREADABLE" };
const BUSY: DocxResult = { ok: false, code: "DOCX_BUSY" };

type Job = { bytes: Uint8Array; resolve: (r: DocxResult) => void };
type Running = Job & { id: number; timer: ReturnType<typeof setTimeout> };

export function createDocxConverter(
  opts: DocxConverterOptions = {},
): DocxConverter & { close(): Promise<void> } {
  const maxPending = Math.max(1, opts.maxPending ?? 2);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const queue: Job[] = [];
  let worker: Worker | null = null;
  let running: Running | null = null;
  let seq = 0;
  let closed = false;

  const kill = () => {
    worker?.terminate();
    worker = null;
  };
  const finish = (id: number, r: DocxResult, crashed = false) => {
    if (!running || running.id !== id) return;
    const job = running;
    clearTimeout(job.timer);
    running = null;
    if (crashed) kill();
    job.resolve(r);
    pump();
  };
  const spawn = (): Worker => {
    const w = new Worker(new URL("./docx.worker.ts", import.meta.url).href);
    w.onmessage = (ev: MessageEvent<{ id: number; result: DocxResult }>) =>
      finish(ev.data.id, ev.data.result);
    w.onerror = () => running && finish(running.id, UNREADABLE, true);
    return w;
  };
  function pump(): void {
    const job = running || closed ? undefined : queue.shift();
    if (!job) {
      if (!running) worker?.unref();
      return;
    }
    worker ??= spawn();
    worker.ref();
    const id = ++seq;
    const timer = setTimeout(() => finish(id, UNREADABLE, true), timeoutMs);
    running = { ...job, id, timer };
    const copy = job.bytes.slice(); // bản riêng ⇒ chuyển quyền buffer, không làm hỏng mảng của người gọi
    worker.postMessage({ id, bytes: copy }, [copy.buffer]);
  }

  return {
    toMarkdown(bytes: Uint8Array): Promise<DocxResult> {
      if (closed || queue.length + (running ? 1 : 0) >= maxPending) return Promise.resolve(BUSY);
      return new Promise((resolve) => {
        queue.push({ bytes, resolve });
        pump();
      });
    },
    async close(): Promise<void> {
      closed = true;
      if (running) {
        clearTimeout(running.timer);
        running.resolve(BUSY);
        running = null;
      }
      for (const j of queue.splice(0)) j.resolve(BUSY);
      kill();
    },
  };
}
