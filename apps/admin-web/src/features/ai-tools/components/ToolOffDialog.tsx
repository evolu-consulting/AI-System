// CR-121 R6 · c16 (chuyển từ tenants/components/tools): hộp xác nhận tắt công cụ cho một công ty — huỷ ⇒ công tắc giữ nguyên.
import type { WorkflowCompany } from "@ai/contracts/workflow-tools";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

type Props = {
  toolName: string;
  company: WorkflowCompany | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function ToolOffDialog({ toolName, company, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={company !== null}
      onOpenChange={(o) => !o && onCancel()}
      title={t("aiTools.off.title", { tool: toolName, company: company?.name ?? "" })}
      description={t("aiTools.off.body")}
      confirmLabel={t("aiTools.off.confirm")}
      destructive
      onConfirm={onConfirm}
    />
  );
}
