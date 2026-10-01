// ADM-FR-13, ADM-FR-30, ADM-FR-50 · M2 · hộp thoại chặn (`alertdialog`): lý do + DependencyList + nút Đóng.
// Dùng khi xoá secret/workflow/feature hoặc tắt workflow đang được dùng (AC-A05).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Câu đã dịch, vd "Không xoá được DIFY_KEY: đang được dùng bởi". */
  title: string;
  children?: ReactNode;
};

export function BlockedDialog({ open, onClose, title, children }: Props) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-72 overflow-y-auto">{children}</div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.dismiss")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
