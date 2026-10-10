// CHAT-AC-55 · HUB-FR-112 · FD6 · PF3: trang DM "Quy trình" (`/process-inbox`). Tài khoản hệ thống ảo (D12) — không phải
// phòng, KHÔNG textbox. Tiêu đề + phụ đề + `log` thông báo (InboxLog) + chân "không nhắn trả lời được".
import { Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InboxLog } from "./InboxLog";

export function ProcessInboxPage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Workflow className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-semibold">{t("process.common.sender.name")}</h1>
          <p className="text-caption text-muted-foreground">{t("process.inbox.dm.subtitle")}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InboxLog />
      </div>
      <footer className="border-t border-border px-4 py-3 text-center text-caption text-muted-foreground">
        {t("process.inbox.dm.footer")}
      </footer>
    </div>
  );
}
