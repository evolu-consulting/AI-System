// CR-118 · cr118-community-files · spec §11.1 "Đính kèm": luật thuần tệp của bài. Loại/trần lấy từ cấu hình upload hiện có
// (`ATTACH_ALLOWED`, `ATTACH_MAX_BYTES`); KHÔNG tin đuôi: nội dung phải khớp chữ ký của đuôi (nhị phân) hoặc là UTF-8 sạch,
// không phải markup trình duyệt chạy được (nhóm chữ). File chạy được (MZ/ELF/#!) luôn bị chặn. Gói không import module
// attachments của hub (dependency-cruiser `pack-no-hub-modules`) ⇒ luật tự chứa ở đây.
/** Đuôi (chữ thường) → MIME được phép (người gọi truyền `ATTACH_ALLOWED`). */
export type Allowed = Readonly<Record<string, string>>;

const NAME_MAX = 200;

type Ext = string;
const ascii = (s: string): number[] => [...s].map((ch) => ch.charCodeAt(0));
const at = (b: Uint8Array, sig: readonly number[], off = 0): boolean =>
  b.length >= off + sig.length && sig.every((x, i) => b[off + i] === x);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const SIG: Readonly<Record<string, (b: Uint8Array) => boolean>> = {
  pdf: (b) => at(b, ascii("%PDF-")),
  png: (b) => at(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => at(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => at(b, [0xff, 0xd8, 0xff]),
  gif: (b) => at(b, ascii("GIF87a")) || at(b, ascii("GIF89a")),
  webp: (b) => at(b, ascii("RIFF")) && at(b, ascii("WEBP"), 8),
  docx: (b) => at(b, ZIP),
  xlsx: (b) => at(b, ZIP),
  pptx: (b) => at(b, ZIP),
};
const TEXT: ReadonlySet<Ext> = new Set(["txt", "md", "csv", "xml", "json"]);

/** MZ ∨ ELF ∨ `#!` (kể cả sau BOM UTF-8). */
export function isExecutable(b: Uint8Array): boolean {
  const s = at(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  return at(b, [0x4d, 0x5a]) || at(b, [0x7f, 0x45, 0x4c, 0x46]) || at(b, [0x23, 0x21], s);
}

/** Markup trình duyệt có thể chạy (HTML/SVG/script) ở đầu hoặc bất kỳ đâu trong tài liệu chữ. */
const MARKUP_RE =
  /<\s*(!doctype\s+html|html[\s>]|script[\s>]|svg[\s>]|iframe[\s>]|body[\s>]|head[\s>])/i;

function cleanText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  let s: string;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return false;
  }
  return !MARKUP_RE.test(s);
}

/** Đuôi chữ thường của tên (1–10 chữ/số sau `.` cuối, vị trí > 0); khác ⇒ null. */
export function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

/** MIME theo NỘI DUNG khi đuôi ∈ ATTACH_ALLOWED và nội dung khớp đuôi; khác (đuôi lạ, đội lốt, file chạy được) ⇒ null. */
export function sniffMime(name: string, bytes: Uint8Array, allowed: Allowed): string | null {
  const e = extOf(name);
  if (e === null || !Object.hasOwn(allowed, e)) return null;
  if (bytes.length === 0 || isExecutable(bytes)) return null;
  const ok = TEXT.has(e) ? cleanText(bytes) : Object.hasOwn(SIG, e) && (SIG[e]?.(bytes) ?? false);
  return ok ? (allowed[e] ?? null) : null;
}

// Điều khiển C0/C1, ALM, zero-width + LRM/RLM, LS/PS, bidi embed/override/isolate, BOM.
const INVISIBLE: [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const INVISIBLE_RE = new RegExp(
  `[${INVISIBLE.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`,
  "gu",
);

/** Tên hiển thị an toàn: NFC → phần sau `/`/`\` cuối → bỏ ký tự vô hình/bidi → bỏ khoảng trắng/`.` hai đầu → ≤ 200 (giữ đuôi). */
export function safeFileName(raw: string): string {
  const nfc = raw.normalize("NFC");
  const base = nfc.slice(Math.max(nfc.lastIndexOf("/"), nfc.lastIndexOf("\\")) + 1);
  const name = base.replace(INVISIBLE_RE, "").replace(/^[\s.]+|[\s.]+$/gu, "");
  if (name === "") return "file";
  if (name.length <= NAME_MAX) return name;
  const ext = extOf(name);
  const tail = ext ? `.${ext}` : "";
  return (
    [...name.slice(0, name.length - tail.length)].slice(0, NAME_MAX - tail.length).join("") + tail
  );
}

/** Ảnh ⇒ `image` (xem trước); mọi loại khác ⇒ `file` (tải về). */
export const mediaKindOf = (mime: string): "image" | "file" =>
  mime.startsWith("image/") ? "image" : "file";

/** Chỉ ảnh raster được hiển thị inline; còn lại luôn `attachment` (không render tài liệu/chữ trong origin của API). */
export function contentDisposition(name: string, mime: string): string {
  const type = mediaKindOf(mime) === "image" ? "inline" : "attachment";
  let fallback = "";
  for (const ch of name.normalize("NFKD").replace(/\p{M}/gu, ""))
    fallback += /^[\x20-\x7e]$/.test(ch) && ch !== '"' && ch !== "\\" ? ch : "_";
  const pct = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${pct}`;
}

/** Header tải về cố định (nosniff + CSP khoá mọi thứ + không cache dùng chung). */
export function downloadHeaders(f: { name: string; mime: string; size: number }) {
  return {
    "Content-Type": f.mime,
    "Content-Length": String(f.size),
    "Content-Disposition": contentDisposition(f.name, f.mime),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  };
}
