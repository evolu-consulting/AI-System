// ADM-FR-23 · X1 F4 · 409 `SIDE_EFFECT_CONFIRM_REQUIRED` (plan-frontend-copy.md): `alertdialog`; "Vẫn chạy" ⇒ gửi lại
// kèm `confirm_side_effect:true`; Huỷ/Esc ⇒ đóng, không gửi.
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type Props = { open: boolean; onConfirm: () => void; onCancel: () => void };

export function SideEffectConfirm({ open, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("commands.test.confirm.body")}
      confirmLabel={t("commands.test.confirm.run")}
      cancelLabel={t("commands.test.confirm.cancel")}
      onConfirm={onConfirm}
    />
  );
}
