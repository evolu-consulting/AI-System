// M3 · D3-04 · ADR-0028: tệp gốc PDF của HĐ ⇒ chữ cho lượt AI đọc — tải bytes từ FileBox org của tenant rồi `PdfConverter` (unpdf
// trong Bun Worker). PDF scan ⇒ `PDF_NEEDS_OCR` (OCR ngoài phạm vi); hỏng/quá lớn/bận ⇒ mã của port. Loại khác (ảnh) ⇒ null
// (đường cũ: `AGENT_UNAVAILABLE`). Không ném, không log nội dung.
import type { PdfConverter } from "../../kit/domain/pdf.rules";
import type { SourceFileText } from "../application/extraction.ports";

export type FileContent = (org: string) => {
  getContent(fileId: string): Promise<Uint8Array | null>;
};

export function pdfSourceText(d: { files: FileContent; pdf: PdfConverter }): SourceFileText {
  return async (who, f) => {
    if (f.mime !== "application/pdf") return null;
    let bytes: Uint8Array | null;
    try {
      bytes = await d.files(f.org).getContent(f.fileId);
    } catch {
      return { ok: false, code: "SOURCE_UNAVAILABLE" };
    }
    if (!bytes) return { ok: false, code: "SOURCE_UNAVAILABLE" };
    const r = await d.pdf.toText(bytes, { tenantId: who.tenantId });
    if (!r.ok) return { ok: false, code: r.code };
    return r.markdown.trim()
      ? { ok: true, text: r.markdown }
      : { ok: false, code: "PDF_NEEDS_OCR" };
  };
}
