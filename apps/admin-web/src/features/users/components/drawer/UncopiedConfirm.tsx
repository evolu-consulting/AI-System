// ADM-FR-04 · hỏi lại khi đóng khối mật khẩu tạm mà chưa sao chép: [Quay lại] [Đóng].
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onClose: () => void };

export function UncopiedConfirm({ open, onOpenChange, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("tempPassword.closeUncopied.title")}
      description={t("tempPassword.closeWarning")}
      cancelLabel={t("tempPassword.closeUncopied.back")}
      confirmLabel={t("common.close")}
      destructive
      onConfirm={onClose}
    />
  );
}
