// ADM-FR-73 · P-d2 (plan-frontend-d2 §12): hộp xác nhận tắt tool — `alertdialog "Tắt tool {name}?"` (huỷ ⇒ công tắc giữ nguyên).
import type { TenantWorkflowTool } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type Props = {
  tool: TenantWorkflowTool | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function ToolOffDialog({ tool, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={tool !== null}
      onOpenChange={(o) => !o && onCancel()}
      title={t("tenants.tools.offTitle", { name: tool?.name ?? "" })}
      description={t("tenants.tools.offBody")}
      confirmLabel={t("tenants.tools.offConfirm")}
      destructive
      onConfirm={onConfirm}
    />
  );
}
