// HUB-FR-69 · chặn rời trang khi form chưa lưu: useBlocker + beforeunload + hộp "Bỏ thay đổi chưa lưu?" [Ở lại] [Rời trang].
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
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";

export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker({
    // Chỉ chặn khi đổi trang; đổi tham số tìm kiếm trong cùng trang không mất dữ liệu.
    shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <AlertDialog open={blocker.status === "blocked"} onOpenChange={(o) => !o && blocker.reset?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unsaved.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("unsaved.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("unsaved.stay")}</AlertDialogCancel>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            {t("unsaved.leave")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
