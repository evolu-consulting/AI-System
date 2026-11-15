// HUB-FR-44 · CR-164 · tệp trong tin (`Message.attachments`): bộ hiển thị chung (lưới ảnh + thẻ tệp); tải qua fetch có
// Authorization; `available=false` → thẻ xám.
import type { AttachmentRef } from "@ai/contracts/chat";
import { AttachGallery } from "@ai/web-kit/ui/AttachGallery";
import { toast } from "@ai/web-kit/ui/toast";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { attachLabels, attachmentUrl, toAttachItem } from "../lib/attachView";
import { downloadAttachment } from "../lib/download";

export function AttachmentList({ items }: { items?: readonly AttachmentRef[] }) {
  const { t, i18n } = useTranslation();
  const mapped = useMemo(() => (items ?? []).map(toAttachItem), [items]);
  if (mapped.length === 0) return null;
  return (
    <AttachGallery
      items={mapped}
      ariaLabel={t("attach.messageList")}
      getUrl={attachmentUrl}
      locale={i18n.language}
      labels={attachLabels(t)}
      onDownload={(a) =>
        downloadAttachment(a.id, a.name).catch(() => toast.error(t("attach.downloadFailed")))
      }
    />
  );
}
