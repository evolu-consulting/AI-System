// CHAT-AC-17 · < 640px: Sheet đáy ~83vh "Flow đang mở", tay nắm "Kéo để đóng" (kéo > 120px), ✕ / "Thu nhỏ flow" đóng.
import { type CSSProperties, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import type { ComposerHandle } from "~/features/composer/components/Composer";
import { cn } from "~/lib/utils";
import { useSheetDrag } from "../hooks/use-sheet-drag";
import { FlowContent, type FlowContentProps } from "./FlowContent";

/** Trượt lên ngắn (1,5rem) thay vì cả chiều cao: tay nắm gần như đứng yên ngay khi mở → bấm/kéo trúng. */
const ENTER = { "--tw-enter-translate-y": "1.5rem" } as CSSProperties;

export function FlowSheet(props: Omit<FlowContentProps, "mobile" | "composerRef">) {
  const { t } = useTranslation();
  const composer = useRef<ComposerHandle>(null);
  const drag = useSheetDrag(props.onClose);
  const running = props.data.composer.running;
  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
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
        <FlowContent {...props} mobile composerRef={composer} />
      </SheetContent>
    </Sheet>
  );
}
