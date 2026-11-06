// HD-FR-08 · HD-AC10 · D-06 · D-09 · plan §4–§5: nhận dạng tệp theo magic bytes, ngày tải lên theo múi tenant, trần tải lên. Thuần.

export type SniffedType =
  | "pdf"
  | "docx"
  | "jpeg"
  | "png"
  | "md"
  | "webp"
  | "gif"
  | "text"
  | "office";

const startsWith = (head: Uint8Array, sig: readonly number[]): boolean =>
  head.length >= sig.length && sig.every((b, i) => head[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38]; // GIF8
/** Phần đặc trưng của xlsx / pptx / odt (zip-office lấy chữ). */
const OFFICE_MARKERS = ["xl/workbook.xml", "ppt/presentation.xml", "content.xml"];

/** zip chỉ là docx khi `zipNames` (central directory) có `word/document.xml`; thiếu danh sách ⇒ null (không đoán từ "PK"). */
export function sniffFileType(head: Uint8Array, zipNames?: readonly string[]): SniffedType | null {
  if (startsWith(head, PDF)) return "pdf";
  if (startsWith(head, JPEG)) return "jpeg";
  if (startsWith(head, PNG)) return "png";
  if (startsWith(head, GIF)) return "gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (startsWith(head, ZIP) && zipNames?.includes("word/document.xml")) return "docx";
  if (startsWith(head, ZIP) && zipNames?.some((n) => OFFICE_MARKERS.includes(n))) return "office";
  return null;
}

/** CR-122 p9: định dạng nhận ra được nhưng AI chưa đọc (model không nhận, không lấy chữ được) ⇒ báo đúng tên thay vì "loại tệp không hợp lệ". */
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...Array.from(b.subarray(from, to)));
export function unreadableFormat(head: Uint8Array): string | null {
  if (ascii(head, 4, 8) === "ftyp" && HEIC_BRANDS.includes(ascii(head, 8, 12))) return "heic";
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a]))
    return "tiff";
  if (startsWith(head, [0x42, 0x4d])) return "bmp";
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) return "doc/xls/ppt";
  return null;
}

const MD_NAME = /\.(md|markdown)$/i;
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Gap #9: Markdown không có chữ ký ⇒ chỉ nhận khi tên khai báo `.md`/`.markdown` VÀ nội dung là UTF-8 hợp lệ, không có byte NUL
 *  (tệp nhị phân đổi tên không lọt). Trả chữ (bỏ BOM) hoặc null. */
export function markdownText(bytes: Uint8Array, name: string): string | null {
  if (!MD_NAME.test(name) || bytes.length === 0 || bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

/** YYYY-MM-DD của `now` theo múi `timeZone` (Intl, không phụ thuộc TZ tiến trình). */
export function uploadDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

export type QuotaCount = { tenant: number; global: number };
/** `c` = đếm SAU INCR; > trần mới vượt; vượt cả hai ⇒ "tenant". */
export function quotaVerdict(c: QuotaCount, l: QuotaCount): "ok" | "tenant" | "global" {
  if (c.tenant > l.tenant) return "tenant";
  return c.global > l.global ? "global" : "ok";
}
