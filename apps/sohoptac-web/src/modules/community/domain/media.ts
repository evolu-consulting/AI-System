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

export type UploadNotice = {
  key: string;
  params?: Record<string, string | number>;
  /** Câu nối sau (vd gợi ý thời điểm thử lại). */
  retry?: { key: string; params: Record<string, string | number> };
};

const QUOTA_SCOPES = ["user", "tenant", "global", "busy"] as const;

/** Giờ mở lại hạn mức, theo ngôn ngữ UI; ISO hỏng ⇒ chuỗi rỗng. */
export function formatResetTime(iso: string, locale = "vi-VN"): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

/**
 * Lỗi `POST /pack/community/files` ⇒ thông báo (khoá i18n + tham số): 413 quá cỡ, 415 loại không cho phép, 503 chưa bật kho tệp,
 * 429 `UPLOAD_QUOTA` {scope user|tenant|global|busy, limit, resets_at} (kèm giờ thử lại nếu có), 503 `UPLOAD_QUOTA_UNAVAILABLE`.
 */
export function uploadNotice(
  err: { status?: number; code?: string; details?: unknown },
  locale = "vi-VN",
): UploadNotice {
  const { status, code } = err;
  if (code === "UPLOAD_QUOTA_UNAVAILABLE") return { key: "community.composer.quota.unavailable" };
  if (status === 429 && code === "UPLOAD_QUOTA") {
    const d = (err.details ?? {}) as { scope?: string; limit?: number; resets_at?: string };
    const scope = QUOTA_SCOPES.find((s) => s === d.scope) ?? "tenant";
    const time = d.resets_at ? formatResetTime(d.resets_at, locale) : "";
    return {
      key: `community.composer.quota.${scope}`,
      params: { limit: d.limit ?? 0 },
      ...(time ? { retry: { key: "community.composer.quota.retryAt", params: { time } } } : {}),
    };
  }
  if (status === 413) return { key: "community.composer.fileTooLarge" };
  if (status === 415) return { key: "community.composer.fileTypeNotAllowed" };
  if (status === 503) return { key: "community.composer.filesUnavailable" };
  return { key: "community.composer.uploadFailed" };
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
