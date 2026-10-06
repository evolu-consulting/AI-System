// HUB-FR-44 · tệp trong tin (`Message.attachments`): bấm tải qua fetch có Authorization; `available=false` → xám.
import type { AttachmentRef } from "@ai/contracts/chat";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { downloadAttachment, formatSize } from "../lib/download";

export function AttachmentList({ items }: { items?: readonly AttachmentRef[] }) {
  const { t } = useTranslation();
  if (!items || items.length === 0) return null;
  const download = (a: AttachmentRef) => {
    if (!a.available) return;
    downloadAttachment(a.id, a.filename).catch(() => toast.error(t("attach.downloadFailed")));
  };
  return (
    <ul aria-label={t("attach.messageList")} className="flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            aria-disabled={a.available ? undefined : true}
            title={a.available ? undefined : t("attach.unavailable")}
            aria-label={t("attach.download", { filename: a.filename })}
            onClick={() => download(a)}
            className={cn(
              "flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted px-2 py-1 text-xs",
              a.available
                ? "text-foreground hover:bg-foreground/10"
                : "cursor-not-allowed text-muted-foreground opacity-60",
            )}
          >
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate font-medium">{a.filename}</span>
            <span aria-hidden="true">{formatSize(a.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
