// CHAT-AC-02 · tài khoản / công ty bị khoá: modal `alertdialog` (UC-01), không nói thêm chi tiết.
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

type Props = { open: boolean; onClose: () => void };

export function LockedDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("login.locked")}</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">{t("login.locked")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>{t("login.lockedOk")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
