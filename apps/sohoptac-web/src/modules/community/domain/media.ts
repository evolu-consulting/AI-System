// CR-118 · COM-FR-37 · tệp đính kèm bài đăng (thuần): loại theo MIME của tệp chọn, dung lượng hiển thị.
// Hiện server chỉ lưu ảnh/video (nhãn + url http(s)); tệp khác (PDF…) chờ route FileBox của community ở server (lát F).

import type { MediaItem } from "@ai/contracts/community";
import { canAddMedia } from "./compose";

export type AttachKind = "image" | "video" | "file";

/** image/* ⇒ ảnh, video/* ⇒ video, còn lại ⇒ tệp. */
export const attachKindOf = (mime: string): AttachKind =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";

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

export type AttachNotice = "fileUnsupported" | "maxImages" | "maxVideos";

/** Thêm các tệp chọn vào danh sách media (thuần): ảnh/video theo MIME còn chỗ ⇒ thêm; còn lại ⇒ ghi chú để UI báo. */
export function attachFiles(
  media: MediaItem[],
  files: { name: string; type: string }[],
  now: number,
): { media: MediaItem[]; notices: AttachNotice[] } {
  const notices: AttachNotice[] = [];
  let out = media;
  for (const f of files) {
    const kind = attachKindOf(f.type);
    if (kind === "file") notices.push("fileUnsupported");
    else if (!canAddMedia(out, kind)) notices.push(kind === "image" ? "maxImages" : "maxVideos");
    else out = [...out, { id: `${kind}-${now}-${out.length}`, kind, label: f.name }];
  }
  return { media: out, notices };
}
