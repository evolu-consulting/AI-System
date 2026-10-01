// ADM-FR-13 · M2-R11 · xác nhận xoá workflow chưa gắn: mức nặng, gõ lại key mới bật nút "Xoá workflow".
import type { WorkflowListItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type Props = {
  target: WorkflowListItem | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function WorkflowDeleteDialog({ target, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const key = target?.key ?? "";
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      title={t("workflows.delete.title", { key })}
      confirmLabel={t("workflows.delete.submit")}
      destructive
      level="heavy"
      confirmText={target?.key}
      typePrompt={t("workflows.delete.typeToConfirm", { key })}
      onConfirm={onConfirm}
    />
  );
}
