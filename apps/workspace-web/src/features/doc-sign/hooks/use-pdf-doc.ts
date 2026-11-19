// CR-181 · nạp PDF bằng pdf.js (lười, worker cục bộ như PdfPane) + kích thước điểm của từng trang đã xoay.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import { type OpenedPdf, openPdf } from "~/lib/pdf-worker";
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
    let opened: OpenedPdf | undefined;
    setSt({ status: "loading" });
    (async () => {
      const data = new Uint8Array(await file.load());
      if (dead) return;
      opened = await openPdf(data);
      if (dead) return void opened.dispose(); // đã huỷ trong lúc dựng Worker
      const doc = await opened.task.promise;
      const sizes: PageSize[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
        sizes.push({ ptWidth: vp.width, ptHeight: vp.height });
      }
      if (!dead) setSt({ status: "ready", doc, sizes });
    })().catch((e: unknown) => {
      // Không nuốt lỗi: nói rõ nguyên nhân thật ở console (e2e/hỗ trợ đọc được).
      if (!dead) console.error("[doc-sign] không mở được PDF", e);
      if (!dead) setSt({ status: "error" });
    });
    return () => {
      dead = true;
      void opened?.dispose();
    };
  }, [file]);
  return st;
}
