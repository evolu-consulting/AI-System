// CHAT-AC-53 · P-c1 · nút "Huỷ lượt chạy" + hộp xác nhận của thẻ "Cần người quyết". Tự sửa mã: nút viền (mockup Pc-Decision).
import { useTranslation } from "react-i18next";
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

export function CancelAction({
  outline,
  disabled,
  onConfirm,
}: {
  outline: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={outline ? "outline" : "destructive"}
          disabled={disabled}
        >
          {t("process.common.option.cancel")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("process.run.cancel.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("process.run.cancel.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("process.run.cancel.keep")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t("process.run.cancel.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
