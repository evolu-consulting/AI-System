// HUB-FR-131 · mockup 2 · Sheet Thêm / Sửa kết nối. Sau lưu Sheet ở lại ("Đã lưu · v{n}", footer [Đóng]) — mẫu SecretSheet D9/D10.
import type { KhConnection } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { KhConnectionForm } from "./KhConnectionForm";

export type KhSheetTarget = { kind: "create" } | { kind: "edit"; item: KhConnection };

export function KhConnectionSheet({
  target,
  onClose,
}: {
  target: KhSheetTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<number | null>(null);
  const close = () => {
    setSaved(null);
    onClose();
  };
  const item = target?.kind === "edit" ? target.item : undefined;
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent className="sm:max-w-md" showCloseButton={saved === null}>
        <SheetHeader>
          <SheetTitle>
            {t(item ? "knowledgehub.sheet.edit" : "knowledgehub.sheet.create")}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("knowledgehub.sheet.desc")}</SheetDescription>
        </SheetHeader>
        {target ? (
          <KhConnectionForm
            key={item?.id ?? "new"}
            item={item}
            saved={saved}
            onSaved={setSaved}
            onClose={close}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
