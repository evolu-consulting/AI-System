// CR-147b · luật ảnh hồ sơ phía client (thuần): JPG/PNG/WebP, ảnh gốc avatar ≤ 2 MB (sau khi cắt server chỉ nhận ≤ 150 KB), ảnh bìa ≤ 3 MB; avatar cắt vuông giữa ảnh rồi thu về ≤ 256 px.
import { AVATAR_MAX_BYTES, PERSON_COVER_MAX_BYTES } from "@ai/contracts/people";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AVATAR_SIZE = 256;
/** Ảnh gốc người dùng chọn (trước khi cắt/thu nhỏ); khác trần server `AVATAR_MAX_BYTES`. */
export const AVATAR_SOURCE_MAX_BYTES = 2_097_152;
export type ImageKind = "avatar" | "cover";
export const maxBytesOf = (k: ImageKind): number =>
  k === "avatar" ? AVATAR_SOURCE_MAX_BYTES : PERSON_COVER_MAX_BYTES;

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
];

/** Chọn bản mã hoá đầu tiên là PNG/JPG/WebP và ≤ trần server (150 KB); không có ⇒ null (báo «Chưa lưu được ảnh», không gửi tệp gốc). */
export function pickAvatarBlob<T extends { type: string; size: number } | null>(
  blobs: readonly T[],
): NonNullable<T> | null {
  for (const b of blobs) {
    if (b && (IMAGE_TYPES as readonly string[]).includes(b.type) && b.size <= AVATAR_MAX_BYTES)
      return b as NonNullable<T>;
  }
  return null;
}
