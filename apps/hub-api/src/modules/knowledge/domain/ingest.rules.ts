// R1 · N4-FR-02 · port `mgmt-app/api/app/ingest/parse.py` + `chunk.extract_links` (phần thuần): nhận dạng định dạng tệp theo
// đuôi + chữ ký byte, đoán loại tài liệu (hợp đồng ⇒ chia theo "Điều N"), tiêu đề từ tên tệp, liên kết http(s) trong Markdown.

export type FileFormat = "text" | "docx" | "pdf" | "unknown";

const TEXT_EXT = /\.(md|markdown|txt)$/i;
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdfHead = (b: Uint8Array) =>
  b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"

/** Đuôi + chữ ký: `.docx` phải là zip, `.pdf` phải bắt đầu `%PDF` (đuôi giả ⇒ unknown). */
export function fileFormat(filename: string, bytes: Uint8Array): FileFormat {
  const name = filename.toLowerCase();
  if (TEXT_EXT.test(name)) return "text";
  if (name.endsWith(".docx")) return isZip(bytes) ? "docx" : "unknown";
  if (name.endsWith(".pdf")) return isPdfHead(bytes) ? "pdf" : "unknown";
  return "unknown";
}

/** Tên tệp (bỏ thư mục, đuôi, gạch nối/gạch dưới) ⇒ tiêu đề 1–300 ký tự. */
export function titleOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const t = base
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (t || "Tài liệu").slice(0, 300);
}

const CONTRACT_TITLE = /h[ợo]p\s*đ[ồo]ng|hđ\b|contract/iu;
const ARTICLE_LINE = /^[\s#*_>]*(điều|article)\s+\d+/imu;

/** Hợp đồng khi tiêu đề/đầu văn bản nói "hợp đồng" VÀ có dòng "Điều N" (chia theo điều khoản như mgmt-app contracts). */
export function guessKind(title: string, md: string): "contract" | "markdown" {
  const head = md.slice(0, 2000);
  return (CONTRACT_TITLE.test(title) || CONTRACT_TITLE.test(head)) && ARTICLE_LINE.test(md)
    ? "contract"
    : "markdown";
}

const LINK = /\]\((https?:\/\/[^)\s]+)\)/g;

/** `extract_links`: URL http(s) của liên kết Markdown, giữ thứ tự, không trùng, tối đa `max`. */
export function extractLinks(md: string, max = 200): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(LINK)) {
    if (out.size >= max) break;
    out.add(m[1] as string);
  }
  return [...out];
}
