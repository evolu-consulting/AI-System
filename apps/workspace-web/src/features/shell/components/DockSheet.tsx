// PK-FR-10 · TF5 · khoang ở điện thoại: sheet 85 dvh phủ từ dưới lên (trợ lý + tab Tin nhắn, hoặc góp ý).
// CR-177 W1: dùng `Sheet` của kit (Esc đóng, aria-modal, giữ con trỏ trong ngăn, trả focus). Nút đóng của kit ẩn đi vì DockBody đã có nút đóng riêng.
import { Sheet, SheetContent, SheetTitle } from "@ai/web-kit/ui/kit/sheet";
import { useTranslation } from "react-i18next";
import type { DockMode, DockPanel } from "../hooks/use-dock";
import { DockBody } from "./AssistantDock";

export function DockSheet({
  mode,
  panel,
  name,
  onClose,
}: {
  mode: DockMode;
  panel: DockPanel;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        closeLabel={t("contracts.common.close")}
        className="h-[85dvh] max-h-[85dvh] gap-0 overflow-hidden rounded-t-2xl border-t-0 bg-panel p-0 lg:hidden [&>[data-slot=sheet-close]]:hidden"
      >
        <SheetTitle className="sr-only">{name}</SheetTitle>
        <DockBody
          mode={mode}
          panel={panel}
          onClose={onClose}
          closeLabel={t("contracts.common.close")}
        />
      </SheetContent>
    </Sheet>
  );
}
