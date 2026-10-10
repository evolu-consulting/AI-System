// CHAT-AC-53 · plan-frontend-thread §4: nút "Huỷ lượt chạy" + xác nhận. Dùng ở thanh trạng thái thread và `/runs/$id` (PF3).
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { ApiError } from "~/lib/http";
import { useCancelRun } from "../hooks/use-decide";

export type CancelRunButtonProps = {
  runId: string;
  /** `can_cancel` của view; false/vắng ⇒ không vẽ nút. */
  canCancel: boolean | undefined;
  /** Đã huỷ xong (đóng pane / cập nhật trang). */
  onCancelled?: () => void;
};

export function CancelRunButton({ runId, canCancel, onCancelled }: CancelRunButtonProps) {
  const { t } = useTranslation();
  const cancel = useCancelRun(runId);
  const onConfirm = useCallback(async () => {
    try {
      await cancel.mutateAsync();
      toast.success(t("process.run.cancel.done"));
      onCancelled?.();
    } catch (err) {
      const key = err instanceof ApiError ? `process.common.apiError.${err.code}` : "";
      const msg = t(key);
      toast.error(msg && msg !== key ? msg : t("process.common.error.network"));
    }
  }, [cancel, t, onCancelled]);

  if (!canCancel) return null;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={cancel.isPending}>
          {t("process.run.cancel.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("process.run.cancel.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("process.run.cancel.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("process.run.cancel.keep")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm()}>
            {t("process.run.cancel.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
