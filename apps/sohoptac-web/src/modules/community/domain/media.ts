// CR-118 · COM-FR-37 · tệp đính kèm bài đăng (thuần): đổi `CommunityFile` (server đã sniff MIME) ra mục media của bài,
// ánh xạ lỗi upload ra khoá i18n, dung lượng hiển thị.
import type { CommunityFile, MediaItem } from "@ai/contracts/community";

/** Mục media từ tệp đã tải lên: ảnh (theo MIME server sniff) ⇒ `image`, còn lại ⇒ `file`. Gửi `{id,kind,label,fileId}`; server điền lại. */
export const mediaItemOf = (f: CommunityFile): MediaItem => ({
  id: f.id,
  kind: f.mime.startsWith("image/") ? "image" : "file",
  label: f.name,
  fileId: f.id,
  name: f.name,
  size: f.size,
  mime: f.mime,
});

/** Lỗi `POST /pack/community/files` ⇒ khoá i18n: 413 quá cỡ, 415 loại không cho phép, 503 chưa bật FileBox; khác ⇒ chung. */
export function uploadErrorKey(status: number | undefined): string {
  if (status === 413) return "community.composer.fileTooLarge";
  if (status === 415) return "community.composer.fileTypeNotAllowed";
  if (status === 503) return "community.composer.filesUnavailable";
  return "community.composer.uploadFailed";
}

/** 1536 ⇒ "1,5 KB" (dấu thập phân theo `locale` của UI). */
export function formatSize(bytes: number, locale = "vi-VN"): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const n =
    i === 0 ? String(Math.round(v)) : v.toLocaleString(locale, { maximumFractionDigits: 1 });
  return `${n} ${units[i]}`;
}
