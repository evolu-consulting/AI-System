// ADM-FR-20 · bước 2 · thẻ tóm tắt workflow đang chọn: tên, key, mô tả, "n command · m agent", badge Tắt.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";

export type WorkflowSummary = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  commandCount: number;
  agentCount: number;
};

export function WorkflowCard({ workflow }: { workflow: WorkflowSummary }) {
  const { t } = useTranslation();
  const usage = [
    workflow.commandCount > 0
      ? t("workflows.usage.commands", { count: workflow.commandCount })
      : null,
    workflow.agentCount > 0 ? t("workflows.usage.agents", { count: workflow.agentCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{workflow.name}</span>
        <span className="font-mono text-caption text-muted-foreground">{workflow.key}</span>
        {workflow.enabled ? null : <StatusBadge tone="off">{t("common.off")}</StatusBadge>}
      </div>
      <p className="text-caption text-muted-foreground">{workflow.description}</p>
      {usage ? (
        <p className="text-caption">{usage}</p>
      ) : (
        <p className="text-caption">{t("workflows.unattached")}</p>
      )}
    </div>
  );
}
