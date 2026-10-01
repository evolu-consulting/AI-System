// ADM-FR-15 · tab "Đang được dùng bởi": command (link) + agent của workflow; nạp khi mở tab, workflow mới chưa có gì.
import { useTranslation } from "react-i18next";
import { DependencyList } from "@/components/shared/DependencyList";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { loadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { useWorkflowUsages } from "../../hooks/use-workflow-queries";
import { usageSections } from "../../lib/usage";

export function WorkflowUsageTab({ workflowId }: { workflowId: string | undefined }) {
  const { t } = useTranslation();
  const tr = useTr();
  const usages = useWorkflowUsages(workflowId ?? "", !!workflowId);
  if (!workflowId)
    return <p className="text-body text-muted-foreground">{t("workflows.usage.empty")}</p>;
  if (usages.isPending) return <Skeleton className="h-24 w-full" />;
  if (usages.isError) {
    const e = loadError(usages.error);
    return (
      <ErrorState
        message={e?.message ?? ""}
        code={e?.code ?? "HTTP_ERROR"}
        onRetry={() => void usages.refetch()}
      />
    );
  }
  const { commands, agents } = usages.data;
  if (commands.length === 0 && agents.length === 0) {
    return <p className="text-body text-muted-foreground">{t("workflows.usage.empty")}</p>;
  }
  return <DependencyList sections={usageSections(tr, commands, agents)} />;
}
