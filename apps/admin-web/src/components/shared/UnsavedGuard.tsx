// ADM-FR-60 · chặn rời trang khi form chưa lưu: useBlocker + beforeunload + hộp thoại "Bỏ thay đổi?".
import { useBlocker } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";

type Props = { dirty: boolean };

export function UnsavedGuard({ dirty }: Props) {
  const { t } = useTranslation();
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  const blocked = blocker.status === "blocked";
  return (
    <AlertDialog open={blocked} onOpenChange={(open) => !open && blocker.reset?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unsaved.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("unsaved.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("unsaved.stay")}</AlertDialogCancel>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            {t("unsaved.discard")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
