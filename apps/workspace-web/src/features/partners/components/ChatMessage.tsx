// CR-161 · lát 8 · một tin trong trò chuyện hai công ty: tên người gửi (công ty), chữ, tệp (lưới ảnh + thẻ tệp CR-164), giờ.
import type { CcMessage } from "@ai/contracts/pack-contracts";
import type { AttachItem } from "@ai/web-kit/attach-layout";
import { AttachGallery } from "@ai/web-kit/ui/AttachGallery";
import { toast } from "@ai/web-kit/ui/toast";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ccFileUrl } from "../hooks/use-cc-chat";
import { toAttachItem } from "../lib/cc-chat";
import { chatAttachLabels } from "./chat-labels";

/** Tải về: xin link ngắn hạn rồi mở bằng thẻ `a[download]` (không điều hướng trang). */
async function download(item: AttachItem, failed: string): Promise<void> {
  try {
    const a = document.createElement("a");
    a.href = await ccFileUrl(item.id);
    a.download = item.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    toast(failed, "late");
  }
}

export function ChatMessage({ m }: { m: CcMessage }) {
  const { t, i18n } = useTranslation();
  const items = useMemo(() => m.files.map(toAttachItem), [m.files]);
  const time = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(m.created_at));
  return (
    <li
      data-testid="cc-message"
      data-mine={m.mine}
      className={`flex flex-col gap-1 ${m.mine ? "items-end" : "items-start"}`}
    >
      <span className="text-[12px] text-dim">
        {m.sender_name} ({m.sender_company}) · {time}
      </span>
      <div
        className={`flex max-w-[min(32rem,100%)] flex-col gap-2 rounded-2xl px-3.5 py-2 ${m.mine ? "bg-act-bg" : "bg-sunk"}`}
      >
        {m.body && <p className="m-0 text-body break-words whitespace-pre-wrap">{m.body}</p>}
        {items.length > 0 && (
          <AttachGallery
            items={items}
            getUrl={ccFileUrl}
            onDownload={(a) => void download(a, t("contracts.connect.chat.file.failed"))}
            labels={chatAttachLabels(t)}
            locale={i18n.language}
            ariaLabel={t("contracts.connect.chat.file.list")}
          />
        )}
      </div>
    </li>
  );
}
