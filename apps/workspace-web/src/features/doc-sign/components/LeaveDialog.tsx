// CR-181 · «Rời màn ký? Các chữ ký chưa lưu sẽ mất» — AlertDialog danger, focus mặc định ở «Ở lại».
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ai/web-kit/ui/kit/alert-dialog";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useTranslation } from "react-i18next";

export function LeaveDialog(p: { open: boolean; onStay: () => void; onLeave: () => void }) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={p.open} onOpenChange={(o) => !o && p.onStay()}>
      <AlertDialogContent variant="danger">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("contracts.docsign.leave.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("contracts.docsign.leave.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">{t("contracts.docsign.leave.stay")}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="danger" onClick={p.onLeave}>
              {t("contracts.docsign.leave.go")}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
