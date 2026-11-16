// ADM-FR-60 · chặn rời trang khi form chưa lưu: useBlocker + beforeunload + hộp thoại "Bỏ thay đổi?".

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@ai/web-kit/ui/kit/alert-dialog";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

type Props = { dirty: boolean };

export function UnsavedGuard({ dirty }: Props) {
  const { t } = useTranslation();
  const blocker = useBlocker({
    // Chỉ chặn khi rời trang; đổi tab/tham số tìm kiếm trong cùng trang (editor) không mất dữ liệu nên không chặn.
    shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname,
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
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            {t("unsaved.discard")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
