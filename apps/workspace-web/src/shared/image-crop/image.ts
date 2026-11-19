// CR-147b · luật ảnh hồ sơ phía client (thuần): JPG/PNG/WebP. CR-192 BR-2: KHÔNG từ chối ảnh lớn (chỉ chặn tệp phi lý > 40 MB để khỏi cạn bộ nhớ);
// máy người dùng cắt + thu nhỏ (đại diện 400×400 ≤ 150 KB, bìa 1200×400 ≤ 400 KB) trước khi gửi — xem `crop.ts`.
import { AVATAR_MAX_BYTES } from "@ai/contracts/people";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AVATAR_SIZE = 400;
/** Ảnh gốc người dùng chọn (trước khi cắt/thu nhỏ); khác trần server `AVATAR_MAX_BYTES`. */
export const SOURCE_MAX_BYTES = 40 * 1_048_576;
export type ImageKind = "avatar" | "cover";
export const maxBytesOf = (_k: ImageKind): number => SOURCE_MAX_BYTES;

/** "ok" | "type" (không phải JPG/PNG/WebP) | "big" (quá dung lượng). */
export function checkImage(f: { type: string; size: number }, k: ImageKind): "ok" | "type" | "big" {
  if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) return "type";
  return f.size > maxBytesOf(k) ? "big" : "ok";
}

/** Hình vuông lớn nhất ở GIỮA ảnh gốc `w`×`h`. */
export function squareCrop(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

/** Các lần thử xuất avatar (loại, chất lượng) từ đẹp tới nhẹ; trình duyệt không hỗ trợ loại nào thì tự trả PNG nên phải kiểm `blob.type`. */
export const AVATAR_ENCODINGS: ReadonlyArray<readonly [string, number]> = [
  ["image/webp", 0.9],
  ["image/jpeg", 0.85],
  ["image/jpeg", 0.7],
  ["image/jpeg", 0.5],
  ["image/jpeg", 0.35],
];

/** Chọn bản mã hoá đầu tiên là PNG/JPG/WebP và ≤ trần server (150 KB); không có ⇒ null (báo «Chưa lưu được ảnh», không gửi tệp gốc). */
export function pickAvatarBlob<T extends { type: string; size: number } | null>(
  blobs: readonly T[],
  maxBytes: number = AVATAR_MAX_BYTES,
): NonNullable<T> | null {
  for (const b of blobs) {
    if (b && (IMAGE_TYPES as readonly string[]).includes(b.type) && b.size <= maxBytes)
      return b as NonNullable<T>;
  }
  return null;
}
