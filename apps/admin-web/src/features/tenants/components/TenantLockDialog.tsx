// ADM-FR-61 · hộp thoại khoá (mức nặng: gõ lại key) / mở khoá (mức vừa) một tenant.
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

export type LockTarget = { id: string; key: string; userCount: number; locked: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LockTarget | null;
  onConfirm: () => Promise<void>;
};

export function TenantLockDialog({ open, onOpenChange, target, onConfirm }: Props) {
  const { t } = useTranslation();
  const locking = target?.locked ?? true;
  const key = target?.key ?? "";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level={locking ? "heavy" : "medium"}
      destructive={locking}
      title={t(locking ? "tenants.lock.title" : "tenants.unlock.title", { key })}
      description={
        locking
          ? t("tenants.lock.body", { key, users: target?.userCount ?? 0 })
          : t("tenants.unlock.body")
      }
      confirmLabel={t(locking ? "tenants.lock.button" : "tenants.unlock.submit")}
      confirmText={key}
      typePrompt={t("tenants.lock.typeConfirm", { key })}
      onConfirm={onConfirm}
    />
  );
}
