// Mở PDF bằng pdf.js với Worker RIÊNG cho từng lần mở. KHÔNG dùng `GlobalWorkerOptions.workerPort` chung: huỷ một lần mở (effect chạy lại, đổi tệp,
// đóng hộp xem) làm chết Worker chung ⇒ lần mở sau báo «the worker is being destroyed» ⇒ màn ký/hộp xem hiện «Không mở được tệp này».
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

export type OpenedPdf = {
  task: PDFDocumentLoadingTask;
  /** Huỷ lần mở và dừng Worker của nó (gọi khi không dùng nữa; không đụng lần mở khác). */
  dispose: () => Promise<void>;
};

export async function openPdf(data: Uint8Array): Promise<OpenedPdf> {
  const pdfjs = await import("pdfjs-dist");
  const port = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
    type: "module",
  });
  // Typings của pdf.js khai `port` chỉ là null|undefined, nhưng API nhận một Worker.
  const worker = new pdfjs.PDFWorker({ port } as unknown as ConstructorParameters<
    typeof pdfjs.PDFWorker
  >[0]);
  const task = pdfjs.getDocument({ data, worker });
  return {
    task,
    dispose: async () => {
      await task.destroy().catch(() => undefined);
      worker.destroy();
      port.terminate();
    },
  };
}
