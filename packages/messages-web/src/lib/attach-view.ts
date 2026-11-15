// CR-164 / CR-169 · cầu nối tin nhắn ⇒ bộ hiển thị tệp dùng chung (`@ai/web-kit`): đổi `FileRef`/tệp đang chọn sang mục chung + chữ i18n.
import type { FileRef } from "@ai/contracts/pack-contracts";
import type { AttachItem, AttachLabels } from "@ai/web-kit/attach-layout";
import type { DraftItem } from "@ai/web-kit/ui/AttachDraft";

type T = (key: string, opts?: Record<string, unknown>) => string;

export const toAttachItem = (f: FileRef): AttachItem => ({
  id: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
});

export type StagedLike = {
  key: string;
  name: string;
  mime: string;
  size: number;
  file?: File;
  status: "uploading" | "ready";
};

export const toDraftItem = (s: StagedLike): DraftItem => ({
  id: s.key,
  name: s.name,
  mime: s.mime,
  size: s.size,
  ...(s.file ? { file: s.file } : {}),
  status: s.status,
});

export const attachLabels = (t: T): AttachLabels => ({
  openImage: (name) => t("contracts.messages.openImage", { name }),
  prev: t("contracts.messages.attachUi.prev"),
  next: t("contracts.messages.attachUi.next"),
  close: t("contracts.messages.attachUi.close"),
  download: t("contracts.messages.attachUi.download"),
  downloadOf: (name) => t("contracts.messages.download", { name }),
  view: t("contracts.messages.attachUi.view"),
  failed: t("contracts.messages.attachUi.failed"),
  uploading: t("contracts.messages.uploading"),
  retry: t("contracts.messages.retry"),
  remove: (name) => t("contracts.messages.removeFile", { name }),
  unavailable: t("contracts.messages.attachUi.failed"),
});
