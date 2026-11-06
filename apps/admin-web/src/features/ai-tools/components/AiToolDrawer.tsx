// CR-121 R6 · c16 · ngăn chi tiết của một công cụ (artboard AiTools, bấm hàng): mô tả, "Dùng bởi" (agent/lệnh, có link), "Công ty dùng" bật/tắt.
import type { AiToolUsage } from "@ai/contracts/workflow-tools";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DependencyList } from "@/components/shared/DependencyList";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useWorkflowUsages } from "@/features/workflows/api";
import { usageSections } from "@/features/workflows/lib/usage";
import { frozenModulesOn } from "@/lib/frozen";
import { useTr } from "@/lib/use-translate";
import { CompanyToolsList } from "./CompanyToolsList";

function UsedBy({ tool }: { tool: AiToolUsage }) {
  const { t } = useTranslation();
  const tr = useTr();
  const usages = useWorkflowUsages(tool.workflow_id, true);
  const sections = usages.data ? usageSections(tr, usages.data.commands, usages.data.agents) : [];
  const empty = usages.data && sections.every((s) => s.items.length === 0);
  return (
    <section aria-label={t("aiTools.drawer.usedBy")} className="space-y-2">
      <h3 className="text-caption font-semibold text-muted-foreground">
        {t("aiTools.drawer.usedBy")}
      </h3>
      {usages.isError ? (
        <p role="alert" className="text-body text-destructive">
          {t("aiTools.drawer.usedByError")}
        </p>
      ) : null}
      {empty ? (
        <p className="text-body text-muted-foreground">{t("aiTools.drawer.usedByNone")}</p>
      ) : (
        <DependencyList sections={sections} />
      )}
    </section>
  );
}

type Props = { tool: AiToolUsage | undefined; onClose: () => void };

export function AiToolDrawer({ tool, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <DetailDrawer
      open={!!tool}
      onClose={onClose}
      kind={t("aiTools.drawer.kind")}
      title={tool?.name ?? ""}
      status={
        tool
          ? {
              label: t(tool.enabled ? "aiTools.status.on" : "aiTools.status.off"),
              tone: tool.enabled ? "ok" : "off",
            }
          : undefined
      }
      line={
        tool?.side_effect ? (
          <StatusBadge tone="warn">{t("aiTools.drawer.sideEffect")}</StatusBadge>
        ) : null
      }
      facts={tool ? [{ k: t("aiTools.drawer.descriptionLabel"), v: tool.description }] : undefined}
      detail={
        tool ? (
          <Link to="/workflows/$workflowId" params={{ workflowId: tool.workflow_id }}>
            {t("aiTools.drawer.open")}
          </Link>
        ) : null
      }
    >
      {tool ? (
        <>
          <UsedBy tool={tool} />
          {frozenModulesOn ? (
            <CompanyToolsList key={tool.workflow_id} tool={tool} />
          ) : (
            <section aria-label={t("aiTools.drawer.companies")} className="space-y-1">
              <h3 className="text-caption font-semibold text-muted-foreground">
                {t("aiTools.drawer.companies")}
              </h3>
              <p className="text-body font-medium">{t("aiTools.drawer.moduleOff")}</p>
              <p className="text-caption text-muted-foreground">
                {t("aiTools.drawer.moduleOffWhy")}
              </p>
            </section>
          )}
        </>
      ) : null}
    </DetailDrawer>
  );
}
