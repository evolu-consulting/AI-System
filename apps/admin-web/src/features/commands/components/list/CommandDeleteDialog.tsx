// ADM-FR-20 · xác nhận xoá command: mức nặng, gõ lại tên; nêu feature sẽ không còn gõ được lệnh.
import type { CommandListItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { pickLocalized } from "@/lib/localized";

type Props = {
  target: CommandListItem | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function CommandDeleteDialog({ target, onClose, onConfirm }: Props) {
  const { t, i18n } = useTranslation();
  const name = target?.name ?? "";
  const features = target?.features.map((f) => pickLocalized(f.name, i18n.language)).join(", ");
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("commands.delete.title", { name })}
      description={t("commands.delete.body", { features: features ?? "", name })}
      confirmLabel={t("commands.delete.submit")}
      destructive
      level="heavy"
      confirmText={target?.name}
      typePrompt={t("commands.delete.typeToConfirm", { name })}
      onConfirm={onConfirm}
    />
  );
}
