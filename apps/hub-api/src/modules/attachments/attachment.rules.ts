// HUB-FR-44 · H2c-R02, R03, R06, R13, R22 · luật thuần tên file, loại, header, disposition, hạn mức (plan-rules §1, §4).
// B0: chỉ chữ ký (thân ném `not implemented`) — B2/B3.
import type { ATTACH_ALLOWED, AttachMime } from "@ai/contracts/chat";

/** Đuôi được nhận (khoá `ATTACH_ALLOWED`, chữ thường). */
export type AttachExt = keyof typeof ATTACH_ALLOWED;

/** `X-Filename` (percent-encoded ASCII) → tên đã giải mã; `null` khi vắng/rỗng/sai/quá `ATTACH_FILENAME_HEADER_MAX_BYTES`. */
export function parseFilenameHeader(_raw: string | undefined): string | null {
  throw new Error("not implemented: parseFilenameHeader");
}

/** NFC → phần sau `/`/`\` cuối → bỏ ký tự điều khiển/bidi → bỏ khoảng trắng/`.` hai đầu → rỗng = `file` → ≤ 200 UTF-16 (PL12). */
export function displayName(_decoded: string): string {
  throw new Error("not implemented: displayName");
}

/** `.` cuối ở vị trí > 0, sau là 1–10 chữ/số Unicode → `{stem, ext}`; khác → `{stem: name, ext: null}`. */
export function splitExt(_name: string): { stem: string; ext: string | null } {
  throw new Error("not implemented: splitExt");
}

/** Đuôi (không phân biệt hoa) ∈ `ATTACH_ALLOWED`; khác → null. */
export function extOf(_filename: string): AttachExt | null {
  throw new Error("not implemented: extOf");
}

export function mimeOf(_ext: AttachExt): AttachMime {
  throw new Error("not implemented: mimeOf");
}

/** Tên an toàn trên đĩa/trong job: ký tự lạ → `_`, gộp `_`, tên thiết bị Windows, ≤ 120 byte UTF-8 giữ đuôi. */
export function safeName(_filename: string): string {
  throw new Error("not implemented: safeName");
}

/** `attachment; filename="<ascii>"; filename*=UTF-8''<pct>` (R13). */
export function contentDisposition(_filename: string): string {
  throw new Error("not implemented: contentDisposition");
}

/** `image/*` → `image`; khác → `document` (Dify `/files/upload`, R22). */
export function difyFileType(_mime: AttachMime): "image" | "document" {
  throw new Error("not implemented: difyFileType");
}

/** `used + add > max` (R06). */
export function overQuota(_used: number, _add: number, _max: number): boolean {
  throw new Error("not implemented: overQuota");
}
