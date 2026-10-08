// CHAT-AC-14..17 · HUB-FR-101 (X2b D10) · header khung flow (C1 + phòng): tiêu đề, "{n} tin · nhớ cả flow", ✕ / "Thu nhỏ flow".
import { ChevronDown, MessageCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export type FlowHeaderProps = { title: string; count: number; mobile: boolean; onClose(): void };

export function FlowHeader({ title, count, mobile, onClose }: FlowHeaderProps) {
  const { t } = useTranslation();
  const btn = mobile ? "size-11" : "size-9";
  return (
    <header className="flex min-h-[60px] shrink-0 items-center gap-2.5 border-b border-border pr-2 pl-4 py-2">
      {!mobile && <MessageCircle className="size-[18px] shrink-0 text-primary" aria-hidden />}
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <h2 className="truncate text-card-title font-semibold">{title}</h2>
        <span className="text-caption text-muted-foreground">
          {mobile ? t("flow.messageCount", { count }) : t("flow.panelMeta", { count })}
        </span>
      </div>
      {mobile && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={btn}
          aria-label={t("flow.minimize")}
          onClick={onClose}
        >
          <ChevronDown className="size-[18px]" aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={btn}
        aria-label={t("flow.close")}
        onClick={onClose}
      >
        <X className="size-[18px]" aria-hidden />
      </Button>
    </header>
  );
}
