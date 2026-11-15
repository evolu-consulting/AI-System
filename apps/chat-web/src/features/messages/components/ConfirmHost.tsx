// CR-169 · hiển thị hộp xác nhận của `confirm-bus` (AlertDialog của chat-web). Xếp hàng khi có nhiều yêu cầu.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { type PendingConfirm, setConfirmHost } from "../lib/confirm-bus";

export function ConfirmHost() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  useEffect(() => {
    setConfirmHost((r) => setQueue((q) => [...q, r]));
    return () => setConfirmHost(null);
  }, []);
  const cur = queue[0];
  const close = (ok: boolean) => {
    cur?.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  return (
    <AlertDialog open={!!cur} onOpenChange={(o) => !o && close(false)}>
      {cur && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{cur.title}</AlertDialogTitle>
            {cur.body && <AlertDialogDescription>{cur.body}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {cur.cancelLabel ?? t("contracts.messages.cancel")}
            </AlertDialogCancel>
            <Button
              type="button"
              variant={cur.danger ? "destructive" : "default"}
              onClick={() => close(true)}
            >
              {cur.confirmLabel ?? t("shell.messagesConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
