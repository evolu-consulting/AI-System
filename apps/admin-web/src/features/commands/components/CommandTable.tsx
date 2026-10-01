// ADM-FR-20 · bảng Commands: `/tên` + alias, mô tả (+ "EN thiếu"), workflow (+ badge Tắt), feature (chip link), chế độ, công tắc, cập nhật, `⋯`.
import type { CommandListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatUpdated } from "@/lib/format";
import { pickLocalized } from "@/lib/localized";
import { CommandRowMenu } from "./CommandRowMenu";
import { CommandToggle } from "./CommandToggle";

type Props = {
  commands: CommandListItem[] | undefined;
  optimistic: Record<string, boolean>;
  isLoading: boolean;
  isFetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: ReactNode;
  onToggle: (c: CommandListItem, enabled: boolean) => void;
  onDelete: (c: CommandListItem) => void;
};

export function CommandTable({
  commands,
  optimistic,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onToggle,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const columns = useMemo<Column<CommandListItem>[]>(
    () => [
      {
        id: "name",
        header: t("commands.list.col.name"),
        cell: (c) => (
          <div className="min-w-0">
            <Link
              to="/commands/$commandId"
              params={{ commandId: c.id }}
              className="font-mono font-medium text-foreground hover:underline"
            >
              /{c.name}
            </Link>{" "}
            {c.aliases.length ? (
              <span className="font-mono text-caption text-muted-foreground">
                {c.aliases.join(", ")}
              </span>
            ) : null}{" "}
          </div>
        ),
      },
      {
        id: "description",
        header: t("commands.list.col.description"),
        cell: (c) => (
          <div className="max-w-xs">
            <p className="truncate">{pickLocalized(c.description, lang)}</p>{" "}
            {c.description.en?.trim() ? null : (
              <StatusBadge tone="warn">{t("commands.list.enMissing")}</StatusBadge>
            )}
          </div>
        ),
      },
      {
        id: "workflow",
        header: t("commands.list.col.workflow"),
        cell: (c) => (
          <span className="flex items-center gap-2">
            <span className="font-mono">{c.workflow.key}</span>{" "}
            {c.workflow.enabled ? null : <StatusBadge tone="off">{t("common.off")}</StatusBadge>}
          </span>
        ),
      },
      {
        id: "feature",
        header: t("commands.list.col.feature"),
        cell: (c) => (
          <span className="flex flex-wrap gap-1">
            {c.features.map((f) => (
              <Link key={f.id} to="/features/$featureId" params={{ featureId: f.id }}>
                <StatusBadge tone="info">{pickLocalized(f.name, lang)}</StatusBadge>
              </Link>
            ))}
          </span>
        ),
      },
      {
        id: "mode",
        header: t("commands.list.col.mode"),
        cell: (c) => <span className="font-mono text-label">{c.mode}</span>,
      },
      {
        id: "status",
        header: t("commands.list.col.status"),
        cell: (c) => (
          <CommandToggle command={c} optimistic={optimistic[c.id]} onToggle={onToggle} />
        ),
      },
      {
        id: "updated",
        header: t("commands.list.col.updated"),
        cell: (c) => formatUpdated(c.updated_at, c.updated_by),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        className: "w-12 text-right",
        cell: (c) => <CommandRowMenu command={c} onToggle={onToggle} onDelete={onDelete} />,
      },
    ],
    [t, lang, optimistic, onToggle, onDelete],
  );
  return (
    <DataTable
      caption={t("commands.list.title")}
      columns={columns}
      rows={commands}
      getRowKey={(c) => c.id}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      empty={empty}
    />
  );
}
