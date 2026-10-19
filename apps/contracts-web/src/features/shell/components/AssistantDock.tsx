// PK-FR-10 · TF5 · khoang phải: cạnh trái kéo được (280–560, nhớ độ rộng), ruột trợ lý nạp lazy; góp ý (S14) dùng chung khoang, rỗng ở N1.
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import type { DockMode } from "../hooks/use-dock";
import { clampWidth } from "../lib/stored";

const AssistantPanel = lazy(
  () => import(/* webpackChunkName: "assistant" */ "../assistant/AssistantPanel"),
);

/** Ruột khoang: trợ lý (lazy) hoặc khung góp ý. `closeLabel` chỉ có ở khoang gắn bên phải. */
export function DockBody({
  mode,
  onClose,
  closeLabel,
}: {
  mode: DockMode;
  onClose: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  if (mode === "feedback") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-[58px] shrink-0 items-center border-b border-rule px-4">
          <p className="text-body font-semibold">{t("contracts.shell.feedback")}</p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-label text-dim hover:bg-sunk"
          >
            {t("contracts.common.close")}
          </button>
        </div>
        <p className="p-4 text-label text-dim">{t("contracts.shell.feedbackSoon")}</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<Skeleton className="m-4 h-8" />}>
      <AssistantPanel onClose={onClose} closeLabel={closeLabel} />
    </Suspense>
  );
}

export function AssistantDock({
  mode,
  width,
  dragging,
  onDragStart,
  onClose,
}: {
  mode: DockMode;
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
      <DockBody mode={mode} onClose={onClose} closeLabel={t("contracts.shell.collapse")} />
    </aside>
  );
}
