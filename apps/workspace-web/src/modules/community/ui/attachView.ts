// CR-164 · cầu nối Community ⇒ bộ hiển thị tệp dùng chung (`@ai/web-kit`): đổi `MediaItem` sang mục chung + chữ i18n của module.
import type { MediaItem } from "@ai/contracts/community";
import type { AttachItem, AttachLabels } from "@ai/web-kit/attach-layout";
import type { DraftItem } from "@ai/web-kit/ui/AttachDraft";
import { t } from "../i18n";

const mimeOf = (m: MediaItem): string =>
  m.mime ?? (m.kind === "image" ? "image/*" : "application/octet-stream");

/** Mục không có `fileId` (dữ liệu mẫu) ⇒ thẻ xám không tải được. */
export const toAttachItem = (m: MediaItem): AttachItem => ({
  id: m.fileId ?? m.id,
  name: m.name ?? m.label,
  mime: mimeOf(m),
  size: m.size,
  disabled: !m.fileId,
});

export const toDraftItem = (m: MediaItem): DraftItem => ({
  id: m.id,
  name: m.name ?? m.label,
  mime: mimeOf(m),
  size: m.size,
  status: "ready",
});

export const attachLabels = (): AttachLabels => ({
  openImage: (name) => t("community.post.imageOpen", { name }),
  prev: t("community.post.imagePrev"),
  next: t("community.post.imageNext"),
  close: t("community.post.imageClose"),
  download: t("community.post.download"),
  downloadOf: (name) => t("community.post.downloadOf", { name }),
  view: t("community.post.view"),
  failed: t("community.post.downloadFailed"),
  uploading: t("community.composer.uploading"),
  retry: t("community.composer.retry"),
  remove: () => t("community.composer.removeAttachment"),
  unavailable: t("community.post.downloadFailed"),
});
