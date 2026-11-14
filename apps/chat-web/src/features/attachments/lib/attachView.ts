// CR-164 · cầu nối Chat ⇒ bộ hiển thị tệp dùng chung (`@ai/web-kit`): ảnh xem trước đi qua fetch có Authorization (blob URL;
// bộ chung thu hồi khi gỡ), chữ qua i18n chat.
import type { AttachmentRef } from "@ai/contracts/chat";
import type { AttachItem, AttachLabels } from "@ai/web-kit/attach-layout";
import type { DraftItem } from "@ai/web-kit/ui/AttachDraft";
import type { TFunction } from "i18next";
import { fetchAttachmentContent } from "../api";
import type { Chip } from "./queue";

export const toAttachItem = (a: AttachmentRef): AttachItem => ({
  id: a.id,
  name: a.filename,
  mime: a.mime,
  size: a.size,
  disabled: !a.available,
});

export const toDraftItem = (c: Chip, t: TFunction): DraftItem => ({
  id: String(c.uid),
  name: c.file.name,
  mime: c.file.type,
  size: c.file.size,
  file: c.file,
  status: c.status === "error" ? "error" : c.status === "ready" ? "ready" : "uploading",
  errorText: c.errorKey ? t(c.errorKey) : undefined,
  retryable: c.retryable,
});

export const attachmentUrl = async (id: string): Promise<string> =>
  URL.createObjectURL(await fetchAttachmentContent(id));

export const attachLabels = (t: TFunction): AttachLabels => ({
  openImage: (name) => t("attach.openImage", { name }),
  prev: t("attach.prev"),
  next: t("attach.next"),
  close: t("attach.close"),
  download: t("attach.downloadShort"),
  downloadOf: (filename) => t("attach.download", { filename }),
  view: t("attach.view"),
  failed: t("attach.downloadFailed"),
  uploading: t("attach.uploading"),
  retry: t("attach.retry"),
  remove: (filename) => t("attach.remove", { filename }),
  unavailable: t("attach.unavailable"),
});
