// CR-122 p9 · FLOW2-FR-27: đếm số trang PDF lúc tải lên (chỉ đọc xref/trang gốc của pdf.js, không trích chữ) để từ chối sớm
// tệp vượt trần trang. Không đếm được (hỏng/mã hoá lạ) ⇒ null ⇒ không chặn ở đây (bước đọc sẽ báo "tệp hỏng").
import { getDocumentProxy } from "unpdf";

export function pdfPageCounter(limit: number) {
  const count = async (bytes: Uint8Array): Promise<number | null> => {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes), {
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        enableXfa: false,
      });
      const n = pdf.numPages;
      await (pdf as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
      return n;
    } catch {
      return null;
    }
  };
  return Object.assign(count, { limit });
}
