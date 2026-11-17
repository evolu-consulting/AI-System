// CR-181 · nạp PDF bằng pdf.js (lười, worker cục bộ như PdfPane) + kích thước điểm của từng trang đã xoay.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import type { SignFile } from "../components/types";
import type { PageSize } from "../lib/layout";

export type PdfState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; doc: PDFDocumentProxy; sizes: PageSize[] };

export function usePdfDoc(file: SignFile | undefined): PdfState {
  const [st, setSt] = useState<PdfState>({ status: "loading" });
  useEffect(() => {
    if (!file) return;
    let dead = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setSt({ status: "loading" });
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (!pdfjs.GlobalWorkerOptions.workerPort)
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
          { type: "module" },
        );
      const data = new Uint8Array(await file.load());
      const lt = pdfjs.getDocument({ data });
      task = lt;
      const doc = await lt.promise;
      const sizes: PageSize[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
        sizes.push({ ptWidth: vp.width, ptHeight: vp.height });
      }
      if (!dead) setSt({ status: "ready", doc, sizes });
    })().catch(() => !dead && setSt({ status: "error" }));
    return () => {
      dead = true;
      void task?.destroy();
    };
  }, [file]);
  return st;
}
