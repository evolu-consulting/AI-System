// ADM-FR-52 · M4-AC08 · ConfirmDialog vừa "Khôi phục {name} về trạng thái trước v{n}?" (ms §7.2). Không fetch: việc gọi API do `onConfirm`.
import type { AuditItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { restoreParams } from "../lib/restore";

type Props = {
  item: AuditItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
};

export function RestoreDialog({ item, open, onOpenChange, onConfirm }: Props) {
  const { t } = useTranslation();
  const p = restoreParams(item);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("audit.restore.title", { name: p.name, n: p.n })}
      description={t("audit.restore.body", { next: p.next })}
      confirmLabel={t("audit.restore.confirm")}
      onConfirm={onConfirm}
    />
  );
}
