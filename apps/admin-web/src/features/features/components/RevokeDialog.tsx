// ADM-FR-31 · ADM-FR-33 · thu hồi entitlement: ConfirmDialog nặng (gõ mã công ty), nêu số người và command bị ảnh hưởng.
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

export type RevokeTarget = {
  tenantId: string;
  tenantKey: string;
  /** Tên feature hiển thị theo ngôn ngữ đang dùng. */
  feature: string;
  users: number;
  commands: number;
};

type Props = {
  target: RevokeTarget | null;
  onClose: () => void;
  onConfirm: (target: RevokeTarget) => Promise<void>;
};

export function RevokeDialog({ target, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("features.revoke.title", {
        feature: target?.feature ?? "",
        tenant: target?.tenantKey ?? "",
      })}
      description={t("features.revoke.body", {
        users: target?.users ?? 0,
        commands: target?.commands ?? 0,
      })}
      confirmLabel={t("features.revoke.submit")}
      destructive
      level="heavy"
      confirmText={target?.tenantKey}
      typePrompt={t("features.revoke.typeToConfirm", { tenant: target?.tenantKey ?? "" })}
      onConfirm={async () => {
        if (target) await onConfirm(target);
      }}
    />
  );
}
