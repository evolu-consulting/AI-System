// HD1 · byte mẫu cho test tải tệp (tách khỏi hd1.ts cho ≤ 600 dòng).
let seq = 0;
const enc = new TextEncoder();
/** PDF tối thiểu, mỗi lần nội dung khác nhau. */
export const pdf = (extra = 0): Uint8Array =>
  enc.encode(`%PDF-1.4\n% hd1 #${seq++}\n${"x".repeat(extra)}\n%%EOF\n`);
export const jpeg = (): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    16,
    0x4a,
    0x46,
    0x49,
    0x46,
    0,
    1,
    seq++ & 255,
    0xff,
    0xd9,
  ]);
export const png = (): Uint8Array =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    seq++ & 255,
  ]);
export const exe = (): Uint8Array =>
  new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0, seq++ & 255]);
/** Tệp `mb` MiB, mở đầu bằng `%PDF-` (qua kiểm magic bytes, vượt/không vượt trần). */
export const bigPdf = (mb: number): Uint8Array => {
  const b = new Uint8Array(Math.floor(mb * 1024 * 1024));
  b.set(enc.encode("%PDF-1.4\n"), 0);
  return b;
};
