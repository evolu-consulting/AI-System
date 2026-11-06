// CR-121 R6 · c16 · ngăn chi tiết của một công cụ (artboard AiTools, bấm hàng).
// Workflow Dify: mô tả, agent/lệnh gọi tới (có link), "Công ty dùng" bật/tắt. Agent/lệnh: công ty đang dùng (chỉ xem).
import type { AiTool } from "@ai/contracts/workflow-tools";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DependencyList } from "@/components/shared/DependencyList";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWorkflow, useWorkflowUsages } from "@/features/workflows/api";
import { usageSections } from "@/features/workflows/lib/usage";
import { frozenModulesOn } from "@/lib/frozen";
import { useTr } from "@/lib/use-translate";
import type { WorkflowRowActions } from "../hooks/use-workflow-row-actions";
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

/** Thao tác trên workflow chuyển từ danh sách cũ: bật/tắt toàn hệ thống, mở trong Dify, xoá (409 đang dùng ⇒ nêu ai đang dùng). */
function WorkflowActions({ tool, actions }: { tool: AiTool; actions: WorkflowRowActions }) {
  const { t } = useTranslation();
  const q = useWorkflow(tool.id);
  const w = q.data;
  if (!w) return null;
  return (
    <section aria-label={t("aiTools.drawer.actions")} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="ai-tool-enabled">{t("aiTools.drawer.enabledLabel")}</Label>
        <Switch
          id="ai-tool-enabled"
          checked={w.enabled}
          onCheckedChange={() => actions.toggle(w)}
        />
      </div>
      <p className="text-body">
        <span className="text-muted-foreground">{t("aiTools.drawer.secretLabel")}: </span>
        {w.secret.name}
      </p>
      <div className="flex flex-wrap gap-2">
        {w.console_url ? (
          <Button asChild variant="outline" size="sm">
            <a href={w.console_url} target="_blank" rel="noopener noreferrer">
              {t("workflows.menu.openDify")}
              <ExternalLink aria-hidden className="ml-1 size-3.5" />
            </a>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => actions.remove(w)}>
          {t("workflows.menu.delete")}
        </Button>
      </div>
    </section>
  );
}

function DrawerBody({ tool, actions }: { tool: AiTool; actions: WorkflowRowActions }) {
  if (tool.kind !== "workflow") return <ReadonlyCompanies tool={tool} />;
  return (
    <>
      <WorkflowActions tool={tool} actions={actions} />
      <UsedBy tool={tool} />
      {frozenModulesOn ? <CompanyToolsList key={tool.id} tool={tool} /> : <ModuleOff />}
    </>
  );
}

type Props = {
  tool: AiTool | undefined;
  onClose: () => void;
  workflowActions: WorkflowRowActions;
};

export function AiToolDrawer({ tool, onClose, workflowActions }: Props) {
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
      {tool ? <DrawerBody tool={tool} actions={workflowActions} /> : null}
    </DetailDrawer>
  );
}
