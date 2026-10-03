// CHAT-AC-05, CHAT-AC-14 · footer khối flow: Copy · "+N tin trong flow · thời gian" · Trả lời tiếp (mở khung qua `?flow=`, F10).
import { ChevronRight, Copy, LoaderCircle, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { copyText } from "~/features/answer/lib/clipboard";
import { extraMessages } from "../lib/thread-logic";

export type FlowFooterProps = {
  copyValue: string;
  /** `Flow.message_count` (0 khi flow chưa có trong E10). */
  messageCount: number;
  /** Thời gian hoạt động cuối (đã định dạng), null khi chưa có. */
  timeLabel: string | null;
  /** Flow đang mở trong khung bên phải. */
  openHere: boolean;
  /** Run trong khung flow đang chạy (đồng bộ đếm, UC-06). */
  busy: boolean;
  /** `undefined` → nút Trả lời tiếp disabled (flow chưa có trong E10). */
  onReply?: () => void;
};

function FooterMeta({
  messageCount,
  timeLabel,
  openHere,
  busy,
}: Omit<FlowFooterProps, "copyValue">) {
  const { t } = useTranslation();
  const extra = extraMessages({ message_count: messageCount });
  const parts = openHere
    ? [t("flow.openRight"), t("flow.messageCount", { count: messageCount })]
    : [extra > 0 ? t("flow.more", { count: extra }) : null, timeLabel];
  const text = parts.filter(Boolean).join(" · ");
  if (!text && !busy) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-caption text-muted-foreground">
      {busy ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <MessageCircle className="size-3.5" aria-hidden />
      )}
      {text}
    </span>
  );
}

export function FlowFooter({ copyValue, onReply, ...meta }: FlowFooterProps) {
  const { t } = useTranslation();
  const onCopy = async () => {
    if (await copyText(copyValue)) toast.success(t("answer.copied"));
  };
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 border-t border-row-divider pt-2.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-[30px] gap-1.5 px-2.5 text-caption text-muted-foreground"
        disabled={copyValue === ""}
        onClick={() => void onCopy()}
      >
        <Copy className="size-3.5" aria-hidden />
        {t("answer.copy")}
      </Button>
      <span className="grow" />
      <FooterMeta {...meta} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-[30px] gap-1.5 rounded-full px-3 text-caption text-primary-strong"
        disabled={!onReply}
        onClick={onReply}
      >
        {t("flow.reply")}
        <ChevronRight className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
