// CR-121 R6 · c16 · ngăn chi tiết của một công cụ (artboard AiTools, bấm hàng).
// Workflow Dify: mô tả, agent/lệnh gọi tới (có link), "Công ty dùng" bật/tắt. Agent/lệnh: công ty đang dùng (chỉ xem).
import type { AiTool } from "@ai/contracts/workflow-tools";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DependencyList } from "@/components/shared/DependencyList";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useWorkflowUsages } from "@/features/workflows/api";
import { usageSections } from "@/features/workflows/lib/usage";
import { frozenModulesOn } from "@/lib/frozen";
import { useTr } from "@/lib/use-translate";
import { moreCompanies } from "../lib/ai-tools";
import { toolName } from "./AiToolsTable";
import { CompanyToolsList } from "./CompanyToolsList";

function UsedBy({ tool }: { tool: AiTool }) {
  const { t } = useTranslation();
  const tr = useTr();
  const usages = useWorkflowUsages(tool.id, true);
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

/** Agent / lệnh: danh sách công ty đang dùng (chỉ xem). */
function ReadonlyCompanies({ tool }: { tool: AiTool }) {
  const { t } = useTranslation();
  const more = moreCompanies(tool);
  return (
    <section aria-label={t("aiTools.drawer.companies")} className="space-y-2">
      <h3 className="text-caption font-semibold text-muted-foreground">
        {t("aiTools.drawer.companies")}
      </h3>
      {tool.companies_count === 0 ? (
        <p className="text-body text-muted-foreground">{t("aiTools.usedBy.none")}</p>
      ) : (
        <ul className="space-y-1 text-body">
          {tool.companies.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {more > 0 ? (
            <li className="text-muted-foreground">
              {t("aiTools.drawer.moreCompanies", { count: more })}
            </li>
          ) : null}
        </ul>
      )}
      <p className="text-caption text-muted-foreground">{t("aiTools.drawer.readonlyNote")}</p>
    </section>
  );
}

function ModuleOff() {
  const { t } = useTranslation();
  return (
    <section aria-label={t("aiTools.drawer.companies")} className="space-y-1">
      <h3 className="text-caption font-semibold text-muted-foreground">
        {t("aiTools.drawer.companies")}
      </h3>
      <p className="text-body font-medium">{t("aiTools.drawer.moduleOff")}</p>
      <p className="text-caption text-muted-foreground">{t("aiTools.drawer.moduleOffWhy")}</p>
    </section>
  );
}

function DetailLink({ tool }: { tool: AiTool }) {
  const { t } = useTranslation();
  if (tool.kind === "workflow")
    return (
      <Link to="/workflows/$workflowId" params={{ workflowId: tool.id }}>
        {t("aiTools.drawer.open")}
      </Link>
    );
  if (tool.kind === "command")
    return (
      <Link to="/commands/$commandId" params={{ commandId: tool.id }}>
        {t("aiTools.drawer.openCommand")}
      </Link>
    );
  return null;
}

function DrawerBody({ tool }: { tool: AiTool }) {
  if (tool.kind !== "workflow") return <ReadonlyCompanies tool={tool} />;
  return (
    <>
      <UsedBy tool={tool} />
      {frozenModulesOn ? <CompanyToolsList key={tool.id} tool={tool} /> : <ModuleOff />}
    </>
  );
}

type Props = { tool: AiTool | undefined; onClose: () => void };

export function AiToolDrawer({ tool, onClose }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  return (
    <DetailDrawer
      open={!!tool}
      onClose={onClose}
      kind={tool ? t(`aiTools.kind.${tool.kind}`) : t("aiTools.drawer.kind")}
      title={tool ? toolName(tr, tool) : ""}
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
      facts={
        tool?.description
          ? [{ k: t("aiTools.drawer.descriptionLabel"), v: tool.description }]
          : undefined
      }
      detail={tool ? <DetailLink tool={tool} /> : null}
    >
      {tool ? <DrawerBody tool={tool} /> : null}
    </DetailDrawer>
  );
}
