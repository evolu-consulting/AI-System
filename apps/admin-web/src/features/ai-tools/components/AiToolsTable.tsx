// CR-121 R6 · c16 · bảng Công cụ AI (artboard AiTools): Công cụ (+ nhãn loại) · Trạng thái · Dùng bởi (công ty) · Thao tác.
// Bấm hàng ⇒ ngăn chi tiết. Mỗi dòng một công cụ: agent · lệnh · workflow Dify.
import type { AiTool } from "@ai/contracts/workflow-tools";
import { Link } from "@tanstack/react-router";
import { Bot, Info, MoreHorizontal, Terminal, Workflow } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Translate } from "@/lib/format";
import { useTr } from "@/lib/use-translate";
import type { CommandRowActions } from "../hooks/use-command-row-actions";
import type { WorkflowRowActions } from "../hooks/use-workflow-row-actions";
import { type AiToolKind, idTail, initial, moreCompanies } from "../lib/ai-tools";

const KIND_ICON = { agent: Bot, command: Terminal, workflow: Workflow } as const;

/** Tên hiển thị: lệnh `/tên`, agent "Agent …xxxxxx" (admin chỉ biết id), workflow theo tên nghiệp vụ. */
export function toolName(tr: Translate, x: AiTool): string {
  if (x.kind === "agent") return tr("workflows.usage.agent", { id: idTail(x.id) });
  return x.kind === "command" ? `/${x.name}` : (x.name ?? "");
}

function KindBadge({ kind }: { kind: AiToolKind }) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
      <Icon aria-hidden className="size-3" />
      {t(`aiTools.kind.${kind}`)}
    </span>
  );
}

function Companies({ tool }: { tool: AiTool }) {
  const { t } = useTranslation();
  if (tool.companies_count === 0)
    return <span className="text-body text-muted-foreground">{t("aiTools.usedBy.none")}</span>;
  const label = t("aiTools.usedBy.companies", { count: tool.companies_count });
  return (
    <div className="flex items-center gap-2" title={tool.companies.join(", ")}>
      <span aria-hidden className="flex -space-x-1.5">
        {tool.companies.slice(0, 3).map((n) => (
          <span
            key={n}
            className="grid size-6 place-items-center rounded-full border border-card bg-accent text-caption font-semibold text-accent-foreground"
          >
            {initial(n)}
          </span>
        ))}
      </span>
      <span className="text-label font-medium tabular-nums">{label}</span>
      {moreCompanies(tool) > 0 ? (
        <span className="sr-only">{tool.companies.join(", ")}</span>
      ) : null}
    </div>
  );
}

function RowMenu({
  tool,
  onOpen,
  actions,
  commandActions,
}: {
  tool: AiTool;
  onOpen: (t: AiTool) => void;
  actions: WorkflowRowActions;
  commandActions: CommandRowActions;
}) {
  const { t } = useTranslation();
  const tr = useTr();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("aiTools.menu.label", { name: toolName(tr, tool) })}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(tool)}>{t("aiTools.menu.open")}</DropdownMenuItem>
        {tool.kind === "workflow" ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/workflows/$workflowId" params={{ workflowId: tool.id }}>
                {t("aiTools.menu.edit")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to="/workflows/$workflowId"
                params={{ workflowId: tool.id }}
                search={{ tab: "runs" }}
              >
                {t("aiTools.menu.runs")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.toggleById(tool.id)}>
              {t(tool.enabled ? "workflows.menu.disable" : "workflows.menu.enable")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void actions.removeById(tool.id)}>
              {t("workflows.menu.delete")}
            </DropdownMenuItem>
          </>
        ) : null}
        {tool.kind === "command" ? (
          <DropdownMenuItem asChild>
            <Link to="/commands/$commandId" params={{ commandId: tool.id }}>
              {t("aiTools.menu.edit")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {tool.kind === "command" ? (
          <DropdownMenuItem onSelect={() => void commandActions.toggleById(tool.id, !tool.enabled)}>
            {t(tool.enabled ? "aiTools.menu.disableCommand" : "aiTools.menu.enableCommand")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Props = {
  rows: AiTool[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: React.ReactNode;
  activeId: string | undefined;
  onOpen: (t: AiTool) => void;
  workflowActions: WorkflowRowActions;
  commandActions: CommandRowActions;
};

export function AiToolsTable(p: Props) {
  const active = p.rows?.find((r) => r.id === p.activeId);
  const { t } = useTranslation();
  const tr = useTr();
  const { onOpen, workflowActions, commandActions } = p;
  const columns = useMemo<Column<AiTool>[]>(
    () => [
      {
        id: "tool",
        header: t("aiTools.col.tool"),
        cell: (r) => {
          const Icon = KIND_ICON[r.kind];
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon aria-hidden className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate font-medium" title={toolName(tr, r)}>
                  {toolName(tr, r)}
                </div>
                <KindBadge kind={r.kind} />
              </div>
            </div>
          );
        },
      },
      {
        id: "status",
        header: t("aiTools.col.status"),
        cell: (r) => (
          <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap">
            <i
              aria-hidden
              className={`inline-block size-2 rounded-full ${r.enabled ? "bg-success" : "bg-muted-foreground"}`}
            />
            {t(r.enabled ? "aiTools.status.on" : "aiTools.status.off")}
          </span>
        ),
      },
      {
        id: "usedBy",
        header: (
          <span className="inline-flex items-center gap-1.5">
            {t("aiTools.col.usedBy")}
            <span title={t("aiTools.usedByTip")} role="img" aria-label={t("aiTools.usedByTip")}>
              <Info aria-hidden className="size-3.5" />
            </span>
          </span>
        ),
        cell: (r) => <Companies tool={r} />,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("aiTools.col.actions")}</span>,
        className: "w-12",
        cell: (r) => (
          <RowMenu
            tool={r}
            onOpen={onOpen}
            actions={workflowActions}
            commandActions={commandActions}
          />
        ),
      },
    ],
    [t, tr, onOpen, workflowActions, commandActions],
  );
  return (
    <DataTable
      caption={t("aiTools.title")}
      columns={columns}
      rows={p.rows}
      getRowKey={(r) => `${r.kind}:${r.id}`}
      isLoading={p.isLoading}
      isFetching={p.isFetching}
      error={p.error}
      onRetry={p.onRetry}
      empty={p.empty}
      onRowClick={onOpen}
      activeKey={active ? `${active.kind}:${active.id}` : null}
    />
  );
}
