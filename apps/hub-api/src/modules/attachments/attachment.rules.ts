// HUB-FR-44 · H2c-R02, R03, R06, R13, R22 · luật thuần tên file, loại, header, disposition, hạn mức (plan-rules §1, §4).
import {
  ATTACH_ALLOWED,
  ATTACH_FILENAME_HEADER_MAX_BYTES,
  ATTACH_FILENAME_MAX,
  type AttachMime,
} from "@ai/contracts/chat";

/** Đuôi được nhận (khoá `ATTACH_ALLOWED`, chữ thường). */
export type AttachExt = keyof typeof ATTACH_ALLOWED;

const ENC = new TextEncoder();
const utf8Len = (s: string): number => ENC.encode(s).length;

/** `X-Filename` (percent-encoded ASCII) → tên đã giải mã; `null` khi vắng/rỗng/sai/quá `ATTACH_FILENAME_HEADER_MAX_BYTES`. */
export function parseFilenameHeader(raw: string | undefined): string | null {
  if (!raw || !/^[\x20-\x7e]+$/.test(raw)) return null;
  let out: string;
  try {
    out = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (out === "" || utf8Len(out) > ATTACH_FILENAME_HEADER_MAX_BYTES) return null;
  return out;
}

// Điều khiển C0/C1, ALM (U+061C), zero-width + LRM/RLM, LS/PS (U+2028/2029), nhúng/ghi đè bidi, cô lập bidi, BOM/ZWNBSP
// (U+FEFF) — plan-rules §1 displayName bước 3 (+ REVIEW 1 — Hub RV-6).
const INVISIBLE_RANGES: [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
/** Dựng từ mã số (không để ký tự vô hình/điều khiển dạng thô trong source). */
const INVISIBLE_RE = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`,
  "gu",
);
const EDGE_RE = /^[\s.]+|[\s.]+$/gu;

/** Cắt theo code point (không tách cặp surrogate) tới khi `s.length` ≤ `max` (đơn vị UTF-16). */
function cutUnits(s: string, max: number): string {
  let out = "";
  for (const cp of s) {
    if (out.length + cp.length > max) break;
    out += cp;
  }
  return out;
}

/** NFC → phần sau `/`/`\` cuối → bỏ ký tự điều khiển/bidi → bỏ khoảng trắng/`.` hai đầu → rỗng = `file` → ≤ 200 UTF-16 (PL12). */
export function displayName(decoded: string): string {
  const nfc = decoded.normalize("NFC");
  const base = nfc.slice(Math.max(nfc.lastIndexOf("/"), nfc.lastIndexOf("\\")) + 1);
  const name = base.replace(INVISIBLE_RE, "").replace(EDGE_RE, "");
  if (name === "") return "file";
  if (name.length <= ATTACH_FILENAME_MAX) return name;
  const { stem, ext } = splitExt(name);
  if (ext === null) return cutUnits(name, ATTACH_FILENAME_MAX);
  const tail = `.${ext}`;
  return cutUnits(stem, ATTACH_FILENAME_MAX - tail.length) + tail;
}

const EXT_RE = /^[\p{L}\p{N}]{1,10}$/u;

/** `.` cuối ở vị trí > 0, sau là 1–10 chữ/số Unicode → `{stem, ext}`; khác → `{stem: name, ext: null}`. */
export function splitExt(name: string): { stem: string; ext: string | null } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: null };
  const ext = name.slice(dot + 1);
  if (!EXT_RE.test(ext)) return { stem: name, ext: null };
  return { stem: name.slice(0, dot), ext };
}

/** Đuôi (không phân biệt hoa) ∈ `ATTACH_ALLOWED`; khác → null. */
export function extOf(filename: string): AttachExt | null {
  const ext = splitExt(filename).ext?.toLowerCase();
  return ext !== undefined && Object.hasOwn(ATTACH_ALLOWED, ext) ? (ext as AttachExt) : null;
}

export function mimeOf(ext: AttachExt): AttachMime {
  return ATTACH_ALLOWED[ext];
}

const SAFE_NAME_MAX_BYTES = 120;
const UNSAFE_RE = /[^\p{L}\p{N} ._-]/gu;
/** Tên thiết bị Windows, kể cả số mũ `¹²³` (Windows coi `COM¹` = thiết bị) — RV-6. */
const DEVICE_RE = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/u;

/** Phần trước dấu `.` đầu tiên là tên thiết bị (`CON.tar.pdf` ⇒ Windows vẫn mở `CON`) ⇒ chèn `_` sau phần đó. */
function undevice(stem: string): string {
  const dot = stem.indexOf(".");
  const head = dot < 0 ? stem : stem.slice(0, dot);
  return DEVICE_RE.test(head.toUpperCase()) ? `${head}_${stem.slice(head.length)}` : stem;
}

/** Bớt code point cuối của `s` tới khi `utf8Len(s) + extra` ≤ `max`. */
function cutBytes(s: string, max: number): string {
  const cps = [...s];
  let n = utf8Len(s);
  while (cps.length > 0 && n > max) n -= utf8Len(cps.pop() as string);
  return cps.join("");
}

/** Tên an toàn trên đĩa/trong job: ký tự lạ → `_`, gộp `_`, tên thiết bị Windows (phần trước `.` đầu), ≤ 120 byte giữ đuôi. */
export function safeName(filename: string): string {
  let s = filename.replace(UNSAFE_RE, "_").replace(/_+/g, "_");
  if (s.startsWith(".") || s.startsWith("-")) s = `_${s}`;
  const { stem, ext } = splitExt(s);
  const tail = ext === null ? "" : `.${ext}`;
  let body = undevice(stem);
  if (utf8Len(body) + utf8Len(tail) > SAFE_NAME_MAX_BYTES)
    body = cutBytes(body, SAFE_NAME_MAX_BYTES - utf8Len(tail));
  return body === "" ? "file" : body + tail;
}

/** Phần `filename="…"`: NFKD, bỏ dấu tổ hợp, ngoài ASCII in được hoặc `"`/`\` → `_`. */
function asciiFallback(name: string): string {
  let out = "";
  for (const cp of name.normalize("NFKD").replace(/\p{M}/gu, ""))
    out += /^[\x20-\x7e]$/.test(cp) && cp !== '"' && cp !== "\\" ? cp : "_";
  return out;
}

/** `attachment; filename="<ascii>"; filename*=UTF-8''<pct>` (R13). */
export function contentDisposition(filename: string): string {
  const pct = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${pct}`;
}

/** `image/*` → `image`; khác → `document` (Dify `/files/upload`, R22). */
export function difyFileType(mime: AttachMime): "image" | "document" {
  return mime.startsWith("image/") ? "image" : "document";
}

/** `used + add > max` (R06). */
export function overQuota(used: number, add: number, max: number): boolean {
  return used + add > max;
}
