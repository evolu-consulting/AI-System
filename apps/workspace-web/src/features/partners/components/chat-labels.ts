// CR-161 · lát 8 · chữ i18n cho bộ tệp dùng chung (`AttachGallery`/`AttachDraft`, CR-164) trong trò chuyện hai công ty.
import type { AttachLabels } from "@ai/web-kit/attach-layout";
import type { TFunction } from "i18next";

export const chatAttachLabels = (t: TFunction): AttachLabels => ({
  openImage: (name) => t("contracts.connect.chat.file.openImage", { name }),
  prev: t("contracts.connect.chat.file.prev"),
  next: t("contracts.connect.chat.file.next"),
  close: t("contracts.connect.chat.file.close"),
  download: t("contracts.connect.chat.file.download"),
  downloadOf: (name) => t("contracts.connect.chat.file.downloadOf", { name }),
  view: t("contracts.connect.chat.file.view"),
  failed: t("contracts.connect.chat.file.failed"),
  uploading: t("contracts.connect.chat.file.uploading"),
  retry: t("contracts.connect.chat.file.retry"),
  remove: (name) => t("contracts.connect.chat.file.remove", { name }),
  unavailable: t("contracts.connect.chat.file.failed"),
});
