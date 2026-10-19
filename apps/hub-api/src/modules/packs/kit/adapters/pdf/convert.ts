// ADR-0028: đọc lớp chữ PDF bằng `unpdf` (pdf.js). Chạy TRONG worker (`pdf.worker.ts`); tách file để test gọi thẳng.
// pdf.js: tắt font hệ thống/font-face, fetch của worker, XFA — không tải tài nguyên ngoài; số trang kiểm TRƯỚC khi trích chữ. Không ném.
import { extractText, getDocumentProxy } from "unpdf";
import { isPdf, PDF_MAX_PAGES, type PdfResult, pdfResultOf } from "../../domain/pdf.rules";

/** Giải phóng tài nguyên pdf.js (tên hàm khác nhau giữa bản); không ném. */
async function release(pdf: object): Promise<void> {
  const p = pdf as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> };
  try {
    await (p.destroy ?? p.cleanup)?.call(p);
  } catch {
    // bỏ qua
  }
}

export async function convertPdf(bytes: Uint8Array): Promise<PdfResult> {
  if (!isPdf(bytes)) return { ok: false, code: "PDF_UNREADABLE" };
  try {
    const pdf = await getDocumentProxy(bytes, {
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      enableXfa: false,
    });
    try {
      if (pdf.numPages > PDF_MAX_PAGES) return { ok: false, code: "PDF_TOO_LARGE" };
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      return pdfResultOf(text, totalPages);
    } finally {
      await release(pdf); // lỗi dọn dẹp không được che kết quả đã có
    }
  } catch {
    return { ok: false, code: "PDF_UNREADABLE" };
  }
}
