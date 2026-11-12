// PK-FR-10 · TF5 · khoang phải: cạnh trái kéo được (280–560, nhớ độ rộng), ruột trợ lý nạp lazy; góp ý (S14) dùng chung khoang (khung dùng chung web-kit).
import { FeedbackPanel } from "@ai/web-kit/ui/FeedbackPanel";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { useUnreadTotal } from "~/features/messages/hooks/use-unread";
import { useShellPacks } from "~/shell/use-shell-packs";
import type { DockMode, DockPanel } from "../hooks/use-dock";
import { clampWidth } from "../lib/stored";
import { DockTabs } from "./DockTabs";

const AssistantPanel = lazy(
  () => import(/* webpackChunkName: "assistant" */ "../assistant/AssistantPanel"),
);

const MessagesDockPanel = lazy(
  () =>
    import(
      /* webpackChunkName: "messages-dock" */ "~/features/messages/components/MessagesDockPanel"
    ),
);

/** Ruột khoang: trợ lý (lazy) hoặc khung góp ý. `closeLabel` chỉ có ở khoang gắn bên phải. */
export function DockBody({
  mode,
  panel,
  onClose,
  closeLabel,
}: {
  mode: DockMode;
  panel: DockPanel;
  onClose: () => void;
  closeLabel?: string;
}) {
  const { i18n } = useTranslation();
  const hasMessages = useShellPacks().contracts === true;
  const unread = useUnreadTotal(hasMessages);
  if (mode === "feedback")
    return <FeedbackPanel app="contracts" lang={i18n.language} onClose={onClose} />;
  const tab = hasMessages ? panel.tab : "assistant";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasMessages && (
        <DockTabs
          tab={tab}
          onTab={panel.setTab}
          unread={unread}
          onClose={onClose}
          closeLabel={closeLabel}
        />
      )}
      <div className="min-h-0 flex-1" role={hasMessages ? "tabpanel" : undefined}>
        <Suspense fallback={<Skeleton className="m-4 h-8" />}>
          {tab === "messages" ? (
            <MessagesDockPanel convId={panel.convId} onOpen={panel.setConvId} />
          ) : (
            <AssistantPanel onClose={onClose} closeLabel={closeLabel} />
          )}
        </Suspense>
      </div>
    </div>
  );
}

export function AssistantDock({
  mode,
  panel,
  width,
  dragging,
  onDragStart,
  onClose,
}: {
  mode: DockMode;
  panel: DockPanel;
  width: number;
  dragging: boolean;
  onDragStart: (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={
        mode === "feedback" ? t("contracts.shell.feedback") : t("contracts.shell.assistant")
      }
      style={{ width: clampWidth(width) }}
      data-dragging={dragging || undefined}
      className="relative shrink-0 border-l border-rule bg-panel max-lg:hidden"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: tay kéo (không phải đường kẻ <hr>) */}
      <div
        onMouseDown={onDragStart}
        role="separator"
        aria-label={t("contracts.shell.resize")}
        aria-orientation="vertical"
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-act-soft"
      />
      <DockBody
        mode={mode}
        panel={panel}
        onClose={onClose}
        closeLabel={t("contracts.shell.collapse")}
      />
    </aside>
  );
}
