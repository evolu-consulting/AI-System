// ADM-FR-14 · bảng Workflows: tên + key (mono), loại, "Đang được dùng bởi" (Popover) hoặc "Chưa gắn", trạng thái, menu `⋯`.
import type { WorkflowListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { UsageCell } from "./UsageCell";
import { WorkflowRowMenu } from "./WorkflowRowMenu";

type Props = {
  workflows: WorkflowListItem[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onToggle: (w: WorkflowListItem) => void;
  onDelete: (w: WorkflowListItem) => void;
};

export function WorkflowTable({
  workflows,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onToggle,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const columns = useMemo<Column<WorkflowListItem>[]>(
    () => [
      {
        id: "workflow",
        header: t("workflows.col.workflow"),
        cell: (w) => (
          <div className="min-w-0">
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: w.id }}
              className="font-medium text-foreground hover:underline"
            >
              {w.name}
            </Link>{" "}
            <p className="font-mono text-caption text-muted-foreground">{w.key}</p>
          </div>
        ),
      },
      {
        id: "type",
        header: t("workflows.col.type"),
        cell: (w) => <span className="font-mono text-label">{w.app_type}</span>,
      },
      {
        id: "usedBy",
        header: t("workflows.col.usedBy"),
        cell: (w) => <UsageCell workflow={w} />,
      },
      {
        id: "status",
        header: t("workflows.col.status"),
        cell: (w) => (
          <StatusBadge tone={w.enabled ? "ok" : "off"}>
            {t(w.enabled ? "common.on" : "common.off")}
          </StatusBadge>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-12 text-right",
        cell: (w) => <WorkflowRowMenu workflow={w} onToggle={onToggle} onDelete={onDelete} />,
      },
    ],
    [t, onToggle, onDelete],
  );
  return (
    <DataTable
      caption={t("workflows.list.title")}
      columns={columns}
      rows={workflows}
      getRowKey={(w) => w.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
