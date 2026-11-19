// Gốc lỗi «Không mở được tệp này» (e2e cr181): hai nơi dùng CHUNG một Worker pdf.js toàn cục; huỷ một lần mở (effect chạy lại, đổi tệp) làm chết Worker ⇒
// lần mở kế tiếp báo «the worker is being destroyed». Mỗi lần mở phải có Worker RIÊNG và huỷ riêng.
import { beforeEach, describe, expect, mock, test } from "bun:test";

const log: string[] = [];
let ports = 0;
class FakeWorker {
  id = ++ports;
  terminate() {
    log.push(`terminate:${this.id}`);
  }
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;

class FakePdfWorker {
  constructor(public o: { port: FakeWorker }) {}
  destroy() {
    log.push(`pdfworker.destroy:${this.o.port.id}`);
  }
}
const global = { workerPort: null as unknown };
mock.module("pdfjs-dist", () => ({
  GlobalWorkerOptions: global,
  PDFWorker: FakePdfWorker,
  getDocument: (p: { worker: FakePdfWorker }) => ({
    worker: p.worker,
    promise: Promise.resolve({ numPages: 1 }),
    destroy: async () => {
      log.push(`task.destroy:${p.worker.o.port.id}`);
    },
  }),
}));

const { openPdf } = await import("./pdf-worker");

beforeEach(() => {
  log.length = 0;
  global.workerPort = null;
});

describe("openPdf", () => {
  test("mỗi lần mở một Worker RIÊNG, không đụng Worker toàn cục", async () => {
    const a = await openPdf(new Uint8Array(1));
    const b = await openPdf(new Uint8Array(1));
    expect(global.workerPort).toBeNull();
    expect((a.task as unknown as { worker: FakePdfWorker }).worker.o.port.id).not.toBe(
      (b.task as unknown as { worker: FakePdfWorker }).worker.o.port.id,
    );
  });
  test("huỷ lần mở thứ nhất chỉ dừng Worker của nó, lần thứ hai vẫn dùng được", async () => {
    const a = await openPdf(new Uint8Array(1));
    const b = await openPdf(new Uint8Array(1));
    await a.dispose();
    expect(log).toEqual([
      `task.destroy:${(a.task as unknown as { worker: FakePdfWorker }).worker.o.port.id}`,
      `pdfworker.destroy:${(a.task as unknown as { worker: FakePdfWorker }).worker.o.port.id}`,
      `terminate:${(a.task as unknown as { worker: FakePdfWorker }).worker.o.port.id}`,
    ]);
    expect(await b.task.promise).toMatchObject({ numPages: 1 });
  });
});
