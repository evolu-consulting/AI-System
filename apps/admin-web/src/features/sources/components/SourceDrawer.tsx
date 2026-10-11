// ADM-FR-68 · drawer phải 520px (Sheet): vỏ chung cho Thêm / Sửa / Xem nguồn. `dialog` mang tên = tiêu đề. Có thay đổi chưa lưu ⇒ hỏi bỏ.
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  title: string;
  /** Có nút Lưu (false khi xem / đang tải / không tìm thấy). */
  canSave: boolean;
  pending: boolean;
  dirty: boolean;
  formId: string;
  onClose: () => void;
  children: ReactNode;
};

export function SourceDrawer({ title, canSave, pending, dirty, formId, onClose, children }: Props) {
  const { t } = useTranslation();
  const [askDiscard, setAskDiscard] = useState(false);
  const requestClose = () => (dirty ? setAskDiscard(true) : onClose());
  return (
    <>
      <Sheet open onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          showCloseButton={false}
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 sm:max-w-[520px]"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">{title}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">{children}</div>
          <SheetFooter className="flex-row justify-end border-t border-border">
            <Button variant="outline" onClick={requestClose} disabled={pending}>
              {t("process.sources.cancel")}
            </Button>
            {canSave ? (
              <Button type="submit" form={formId} disabled={pending}>
                {t("process.sources.save")}
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title={t("unsaved.title")}
        description={t("unsaved.body")}
        cancelLabel={t("unsaved.stay")}
        confirmLabel={t("unsaved.discard")}
        destructive
        onConfirm={onClose}
      />
    </>
  );
}
