// CR-164 / CR-169 · tệp trong tin: bộ hiển thị chung `AttachGallery` (lưới ảnh 1/2/3/≥4, bấm phóng to; thẻ tệp xếp dọc). Link FileBox ngắn hạn
// lấy qua API JSON `{url}` khi ô hiện ra (không fetch xuyên origin); tải về bằng thẻ a[download].
import type { FileRef } from "@ai/contracts/pack-contracts";
import { AttachGallery } from "@ai/web-kit/ui/AttachGallery";
import { toast } from "@ai/web-kit/ui/toast";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fetchFileLink } from "../api";
import { attachLabels, toAttachItem } from "../lib/attach-view";
import { errorKey } from "../lib/errors";

function saveFrom(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function MessageFiles({ conv, files }: { conv: string; files: readonly FileRef[] }) {
  const { t, i18n } = useTranslation();
  const items = useMemo(() => files.map(toAttachItem), [files]);
  if (items.length === 0) return null;
  return (
    <div className="mt-1" data-testid="msg-files">
      <AttachGallery
        items={items}
        ariaLabel={t("contracts.messages.sentFiles")}
        labels={attachLabels(t)}
        locale={i18n.language}
        getUrl={(id) => fetchFileLink(conv, id)}
        onDownload={(it) =>
          fetchFileLink(conv, it.id)
            .then((url) => saveFrom(url, it.name))
            .catch((e: unknown) => toast(t(errorKey(e)), "late"))
        }
      />
    </div>
  );
}
