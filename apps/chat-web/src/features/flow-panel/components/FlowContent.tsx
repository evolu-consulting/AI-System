// CHAT-AC-14..17 · nội dung chung của khung flow (panel/sheet): header (tiêu đề, "{n} tin · nhớ cả flow", ✕), luồng tin, ô nhập.
import type { Flow } from "@ai/contracts/chat";
import { ChevronDown, MessageCircle, X } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Composer, type ComposerHandle } from "~/features/composer/components/Composer";
import { draftKey } from "~/features/composer/lib/composer-logic";
import type { FlowPanelData } from "../hooks/use-flow-panel";
import { FlowMessages } from "./FlowMessages";

type HeaderProps = { flow: Flow; mobile: boolean; onClose(): void };

function FlowHeader({ flow, mobile, onClose }: HeaderProps) {
  const { t } = useTranslation();
  const count = flow.message_count;
  const btn = mobile ? "size-11" : "size-9";
  return (
    <header className="flex min-h-[60px] shrink-0 items-center gap-2.5 border-b border-border pr-2 pl-4 py-2">
      {!mobile && <MessageCircle className="size-[18px] shrink-0 text-primary" aria-hidden />}
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <h2 className="truncate text-card-title font-semibold">{flow.title}</h2>
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

export type FlowContentProps = {
  convId: string;
  flow: Flow;
  data: FlowPanelData;
  mobile: boolean;
  onClose(): void;
  composerRef?: Ref<ComposerHandle>;
};

export function FlowContent({
  convId,
  flow,
  data,
  mobile,
  onClose,
  composerRef,
}: FlowContentProps) {
  return (
    <>
      <FlowHeader flow={flow} mobile={mobile} onClose={onClose} />
      <FlowMessages data={data} />
      <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Composer
          ref={composerRef}
          variant="flow"
          draftKey={draftKey(convId, flow.id)}
          autoFocus={!mobile}
          {...data.composer}
        />
      </div>
    </>
  );
}
