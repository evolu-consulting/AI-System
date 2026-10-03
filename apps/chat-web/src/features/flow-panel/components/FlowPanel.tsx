// CHAT-AC-14, CHAT-AC-15 · ≥ 640px: `aside "Flow đang mở"` bên phải (flex 1 1 420px, ≤ 480px); Esc đóng khi không có run.
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { FlowContent, type FlowContentProps } from "./FlowContent";

export function FlowPanel(props: Omit<FlowContentProps, "mobile" | "composerRef">) {
  const { t } = useTranslation();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !props.data.composer.running && !e.defaultPrevented) props.onClose();
  };
  return (
    <aside
      aria-label={t("flow.panel")}
      onKeyDown={onKeyDown}
      className="flex min-h-0 min-w-0 max-w-[480px] flex-[1_1_420px] flex-col border-l border-border bg-card shadow-lg"
    >
      <FlowContent {...props} mobile={false} />
    </aside>
  );
}
