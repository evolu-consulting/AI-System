// ADR-0028 · R1: PDF → văn bản (lớp chữ) cho nạp tri thức; dùng chung được cho gói hợp đồng sau. Luật thuần + giới hạn (khuôn
// ADR-0024): đầu vào ≤ 20 MiB, ≤ 500 trang, chữ ra ≤ 5 triệu ký tự; PDF scan (không lớp chữ) ⇒ `PDF_NEEDS_OCR` — port quyết định
// theo trang trung vị như mgmt-app `parse.is_scanned` (trang < 50 ký tự = ảnh). OCR ngoài phạm vi.

const MiB = 1024 * 1024;
export const PDF_MAX_INPUT = 20 * MiB;
export const PDF_MAX_PAGES = 500;
export const PDF_MAX_CHARS = 5_000_000;
/** Trang có ít ký tự hơn = ảnh (scan/ảnh chụp) — mgmt-app đo: trang số 300–3.300 ký tự, trang scan 0. */
export const PDF_MIN_PAGE_CHARS = 50;

export type PdfErrorCode = "PDF_UNREADABLE" | "PDF_BUSY" | "PDF_TOO_LARGE" | "PDF_NEEDS_OCR";
export type PdfResult =
  | { ok: true; markdown: string; pages: number; warnings: string[] }
  | { ok: false; code: PdfErrorCode };
export type PdfRequestOpts = { tenantId?: string };
/** Port (ADR-0023 §2): không ném — mọi lỗi thành `{ok:false}`. */
export interface PdfConverter {
  toText(bytes: Uint8Array, opts?: PdfRequestOpts): Promise<PdfResult>;
}

/** Chữ ký tệp `%PDF-` (5 byte đầu, cho phép tối đa 1 KiB rác đầu như trình đọc PDF). */
export function isPdf(bytes: Uint8Array): boolean {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  const end = Math.min(bytes.length, 1024) - sig.length;
  for (let i = 0; i <= end; i++) if (sig.every((b, j) => bytes[i + j] === b)) return true;
  return false;
}

/** Cả tệp là scan khi trang trung vị < PDF_MIN_PAGE_CHARS (tệp lẫn theo đa số) — như `is_scanned`. */
export function isScanned(pageTexts: readonly string[]): boolean {
  if (pageTexts.length === 0) return true;
  const sizes = pageTexts.map((t) => t.trim().length).sort((a, b) => a - b);
  return (sizes[Math.floor(sizes.length / 2)] as number) < PDF_MIN_PAGE_CHARS;
}

/** Gom dòng trắng thừa, nối trang bằng dòng trống; vượt trần ⇒ cắt + cảnh báo `truncated`. */
export function pagesToText(pageTexts: readonly string[]): { text: string; warnings: string[] } {
  const text = pageTexts
    .map((p) =>
      p
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
  return text.length > PDF_MAX_CHARS
    ? { text: text.slice(0, PDF_MAX_CHARS), warnings: ["truncated"] }
    : { text, warnings: [] };
}

/** Kết quả từ chữ từng trang (worker gọi sau khi đọc PDF). */
export function pdfResultOf(pageTexts: readonly string[], totalPages: number): PdfResult {
  if (totalPages > PDF_MAX_PAGES) return { ok: false, code: "PDF_TOO_LARGE" };
  if (isScanned(pageTexts)) return { ok: false, code: "PDF_NEEDS_OCR" };
  const { text, warnings } = pagesToText(pageTexts);
  return { ok: true, markdown: text, pages: totalPages, warnings };
}
