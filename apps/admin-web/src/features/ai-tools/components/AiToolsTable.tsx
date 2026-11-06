// CR-121 R6 · c16 · bảng Công cụ AI (artboard AiTools): Công cụ · Trạng thái · Dùng bởi · Thao tác. Bấm hàng ⇒ ngăn chi tiết.
import type { AiToolUsage } from "@ai/contracts/workflow-tools";
import { Link } from "@tanstack/react-router";
import { Bot, MoreHorizontal, Terminal, Workflow } from "lucide-react";
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
import { type UsageKind, usageParts } from "../lib/ai-tools";

const KIND_ICON = { agent: Bot, command: Terminal } as const satisfies Record<UsageKind, unknown>;

function UsedByPills({ tool }: { tool: AiToolUsage }) {
  const { t } = useTranslation();
  const parts = usageParts(tool);
  if (parts.length === 0)
    return <span className="text-body text-muted-foreground">{t("aiTools.usedBy.none")}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map((p) => {
        const Icon = KIND_ICON[p.kind];
        const label = t(`aiTools.usedBy.${p.kind}`, { count: p.count });
        return (
          <span
            key={p.kind}
            title={label}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-muted px-2 text-label font-medium tabular-nums"
          >
            <Icon aria-hidden className="size-3.5 text-muted-foreground" />
            <span aria-hidden>{p.count}</span>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function RowMenu({ tool, onOpen }: { tool: AiToolUsage; onOpen: (t: AiToolUsage) => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("aiTools.menu.label", { name: tool.name })}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(tool)}>{t("aiTools.menu.open")}</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/workflows/$workflowId" params={{ workflowId: tool.workflow_id }}>
            {t("aiTools.menu.edit")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            to="/workflows/$workflowId"
            params={{ workflowId: tool.workflow_id }}
            search={{ tab: "runs" }}
          >
            {t("aiTools.menu.runs")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Props = {
  rows: AiToolUsage[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: React.ReactNode;
  activeId: string | undefined;
  onOpen: (t: AiToolUsage) => void;
};

export function AiToolsTable(p: Props) {
  const { t } = useTranslation();
  const { onOpen } = p;
  const columns = useMemo<Column<AiToolUsage>[]>(
    () => [
      {
        id: "tool",
        header: t("aiTools.col.tool"),
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Workflow aria-hidden className="size-4" />
            </span>
            <span className="truncate font-medium" title={r.name}>
              {r.name}
            </span>
          </div>
        ),
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
      { id: "usedBy", header: t("aiTools.col.usedBy"), cell: (r) => <UsedByPills tool={r} /> },
      {
        id: "actions",
        header: <span className="sr-only">{t("aiTools.col.actions")}</span>,
        className: "w-12",
        cell: (r) => <RowMenu tool={r} onOpen={onOpen} />,
      },
    ],
    [t, onOpen],
  );
  return (
    <DataTable
      caption={t("aiTools.title")}
      columns={columns}
      rows={p.rows}
      getRowKey={(r) => r.workflow_id}
      isLoading={p.isLoading}
      isFetching={p.isFetching}
      error={p.error}
      onRetry={p.onRetry}
      empty={p.empty}
      onRowClick={onOpen}
      activeKey={p.activeId}
    />
  );
}
