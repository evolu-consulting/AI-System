// HUB-FR-78 · AC-H4b2-05 · `alertdialog "Thu hồi {agent} khỏi {tenant}?"` nêu "{n} grant … sẽ mất hiệu lực" (UI §9).
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "#/components/shared/ConfirmDialog";
import type { CellTarget } from "../hooks/use-access-mutations";

export type RevokeTarget = CellTarget & { count: number };

type Props = {
  value: RevokeTarget | null;
  onClose: () => void;
  onConfirm: (v: RevokeTarget) => void;
};

export function RevokeDialog({ value, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const names = { agent: value?.agentKey ?? "", tenant: value?.tenantKey ?? "" };
  return (
    <ConfirmDialog
      open={value !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("access.revoke.title", names)}
      body={t("access.revoke.body", { n: value?.count ?? 0, tenant: names.tenant })}
      confirmLabel={t("access.revoke.confirm")}
      destructive
      onConfirm={() => {
        if (value) onConfirm(value);
        onClose();
      }}
    />
  );
}
