// CHAT-AC-14, CHAT-AC-15, CHAT-AC-17 · HUB-FR-101 (X2b D10) · khung flow dùng chung C1 + phòng: ≥ 640 `aside "Flow đang mở"`
// bên phải (Esc đóng khi không có run), < 640 Sheet đáy ~83vh (tay nắm "Kéo để đóng" > 120px). Nội dung do `children` dựng.
import { type CSSProperties, type KeyboardEvent, type ReactNode, type Ref, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import type { ComposerHandle } from "~/features/composer/components/Composer";
import { cn } from "~/lib/utils";
import { useMinWidth } from "../hooks/use-min-width";
import { useSheetDrag } from "../hooks/use-sheet-drag";

export const FLOW_PANEL_MIN_PX = 640;

/** Ngữ cảnh khung cho nội dung: `mobile` (sheet) + ref composer để focus khi sheet mở. */
export type FlowFrameSlot = { mobile: boolean; composerRef?: Ref<ComposerHandle> };

export type FlowFrameProps = {
  /** Run của khung đang chạy: Esc không đóng (C1). */
  running: boolean;
  onClose(): void;
  children(slot: FlowFrameSlot): ReactNode;
};

/** Trượt lên ngắn (1,5rem) thay vì cả chiều cao: tay nắm gần như đứng yên ngay khi mở → bấm/kéo trúng. */
const ENTER = { "--tw-enter-translate-y": "1.5rem" } as CSSProperties;

export function FlowAside({ running, onClose, children }: FlowFrameProps) {
  const { t } = useTranslation();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !running && !e.defaultPrevented) onClose();
  };
  return (
    <aside
      aria-label={t("flow.panel")}
      onKeyDown={onKeyDown}
      className="flex min-h-0 min-w-0 max-w-[480px] flex-[1_1_420px] flex-col border-l border-border bg-card shadow-lg"
    >
      {children({ mobile: false })}
    </aside>
  );
}

export function FlowBottomSheet({ running, onClose, children }: FlowFrameProps) {
  const { t } = useTranslation();
  const composer = useRef<ComposerHandle>(null);
  const drag = useSheetDrag(onClose);
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          composer.current?.focus();
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
        style={drag.dy > 0 ? { transform: `translateY(${drag.dy}px)` } : ENTER}
        className={cn(
          "h-[83vh] gap-0 rounded-t-2xl border-0 bg-card p-0 data-[state=open]:duration-200",
          drag.dragging && "transition-none",
        )}
      >
        <SheetTitle className="sr-only">{t("flow.panel")}</SheetTitle>
        <button
          type="button"
          aria-label={t("flow.dragClose")}
          className="flex h-11 w-full shrink-0 touch-none cursor-grab items-center justify-center"
          {...drag.grip}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-border" />
        </button>
        {children({ mobile: true, composerRef: composer })}
      </SheetContent>
    </Sheet>
  );
}

/** Chọn aside/sheet theo bề rộng (≥ 640px). */
export function FlowFrame(props: FlowFrameProps) {
  const wide = useMinWidth(FLOW_PANEL_MIN_PX);
  return wide ? <FlowAside {...props} /> : <FlowBottomSheet {...props} />;
}
