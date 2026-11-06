// M3 · D3-04 · ADR-0028: tệp gốc PDF của HĐ ⇒ chữ cho lượt AI đọc — tải bytes từ FileBox org của tenant rồi `PdfConverter` (unpdf
// trong Bun Worker). CR-122 p9 · FLOW2-FR-27: PDF scan (không lớp chữ) KHÔNG còn dừng ở `PDF_NEEDS_OCR` — trả `text: null` + số trang
// để tệp đi thẳng agent đọc bằng thị giác (> `maxPages` hoặc > `maxBytes` ⇒ `PDF_TOO_LARGE`; tải lên đã chặn sớm, đây là lưới
// cho tệp lưu từ trước). Hỏng/bận ⇒ mã của port. Loại khác (ảnh) ⇒ null (tệp đi thẳng agent). Không ném, không log nội dung.
import type { PdfConverter, PdfResult } from "../../kit/public";
import type { SourceFile, SourceFileText } from "../application/extraction.ports";

export type FileContent = (org: string) => {
  getContent(fileId: string): Promise<Uint8Array | null>;
};

/** Trần đọc tệp scan (cấu hình được): không nhận tệp > `maxPages` trang hay > `maxBytes`. */
export type ScanLimits = { maxPages: number; maxBytes: number };
/** Mặc định: 50 trang (người dùng chốt); 20 MiB = trần tải lên. */
export const SCAN_DEFAULTS: ScanLimits = { maxPages: 50, maxBytes: 20 * 1024 * 1024 };

const posInt = (v: string | undefined, def: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : def;
};
/** Env: `CONTRACTS_SCAN_MAX_PAGES` · `CONTRACTS_SCAN_MAX_MB` (sai/vắng ⇒ mặc định). */
export function scanLimits(env: Record<string, string | undefined> = process.env): ScanLimits {
  return {
    maxPages: posInt(env.CONTRACTS_SCAN_MAX_PAGES, SCAN_DEFAULTS.maxPages),
    maxBytes: posInt(env.CONTRACTS_SCAN_MAX_MB, SCAN_DEFAULTS.maxBytes / 1024 / 1024) * 1024 * 1024,
  };
}

async function loadBytes(files: FileContent, f: SourceFile): Promise<Uint8Array | null> {
  try {
    return await files(f.org).getContent(f.fileId);
  } catch {
    return null;
  }
}

/** Kết quả chuyển PDF ⇒ chữ, hoặc (scan) tệp đi thẳng agent, hoặc mã lỗi. */
function textOrScan(r: PdfResult, bytes: Uint8Array, lim: ScanLimits) {
  if (!r.ok && r.code !== "PDF_NEEDS_OCR") return { ok: false as const, code: r.code };
  if (r.ok && r.markdown.trim()) return { ok: true as const, text: r.markdown };
  const pages = r.ok ? r.pages : (r.pages ?? 1);
  if (bytes.length > lim.maxBytes || pages > lim.maxPages)
    return { ok: false as const, code: "PDF_TOO_LARGE" };
  return { ok: true as const, text: null, pages };
}

export function pdfSourceText(d: {
  files: FileContent;
  pdf: PdfConverter;
  limits?: ScanLimits;
}): SourceFileText {
  const lim = d.limits ?? SCAN_DEFAULTS;
  return async (who, f) => {
    if (f.mime !== "application/pdf") return null;
    const bytes = await loadBytes(d.files, f);
    if (!bytes) return { ok: false, code: "SOURCE_UNAVAILABLE" };
    return textOrScan(await d.pdf.toText(bytes, { tenantId: who.tenantId }), bytes, lim);
  };
}

/** Cặp phụ thuộc của gói hợp đồng cho tệp gốc: chữ PDF (kèm trần scan) + bytes để đính kèm lượt AI. */
export function scanFileDeps(files: FileContent, pdf: PdfConverter) {
  return {
    fileText: pdfSourceText({ files, pdf, limits: scanLimits() }),
    fileBytes: files,
  };
}
