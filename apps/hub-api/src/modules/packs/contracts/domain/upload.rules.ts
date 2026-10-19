// HD-FR-08 · HD-AC10 · D-06 · D-09 · plan §4–§5: nhận dạng tệp theo magic bytes, ngày tải lên theo múi tenant, trần tải lên. Thuần.

export type SniffedType = "pdf" | "docx" | "jpeg" | "png";

const startsWith = (head: Uint8Array, sig: readonly number[]): boolean =>
  head.length >= sig.length && sig.every((b, i) => head[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** zip chỉ là docx khi `zipNames` (central directory) có `word/document.xml`; thiếu danh sách ⇒ null (không đoán từ "PK"). */
export function sniffFileType(head: Uint8Array, zipNames?: readonly string[]): SniffedType | null {
  if (startsWith(head, PDF)) return "pdf";
  if (startsWith(head, JPEG)) return "jpeg";
  if (startsWith(head, PNG)) return "png";
  if (startsWith(head, ZIP) && zipNames?.includes("word/document.xml")) return "docx";
  return null;
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
