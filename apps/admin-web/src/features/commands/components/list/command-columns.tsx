// ADM-FR-20 · cột của bảng Commands: `/tên` + alias, mô tả (+ "EN thiếu"), workflow (+ badge Tắt), feature (chip link; rỗng → badge "Chưa gắn feature", CR-055), chế độ, công tắc, cập nhật, `⋯`.
import type { CommandListItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatUpdated, type Translate } from "@/lib/format";
import { pickLocalized } from "@/lib/localized";
import { CommandRowMenu } from "./CommandRowMenu";
import { CommandToggle } from "./CommandToggle";

export type ColumnCtx = {
  t: Translate;
  lang: string;
  optimistic: Record<string, boolean>;
  onToggle: (c: CommandListItem, enabled: boolean) => void;
  onDelete: (c: CommandListItem) => void;
};
type Col = Column<CommandListItem>;

const nameColumn = ({ t }: ColumnCtx): Col => ({
  id: "name",
  header: t("commands.list.col.name"),
  // Khoảng trắng giữa tên và alias: e2e lọc hàng bằng regex `/tên(?![\w-])` trên textContent.
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
        <span className="font-mono text-caption text-muted-foreground">{c.aliases.join(", ")}</span>
      ) : null}{" "}
    </div>
  ),
});

const descriptionColumn = ({ t, lang }: ColumnCtx): Col => ({
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
});

const workflowColumn = ({ t }: ColumnCtx): Col => ({
  id: "workflow",
  header: t("commands.list.col.workflow"),
  cell: (c) => (
    <span className="flex items-center gap-2">
      <span className="font-mono">{c.workflow.key}</span>{" "}
      {c.workflow.enabled ? null : <StatusBadge tone="off">{t("common.off")}</StatusBadge>}
    </span>
  ),
});

const featureColumn = ({ t, lang }: ColumnCtx): Col => ({
  id: "feature",
  header: t("commands.list.col.feature"),
  cell: (c) => (
    <span className="flex flex-wrap gap-1">
      {c.features.length === 0 ? (
        <StatusBadge tone="warn">{t("commands.list.noFeature")}</StatusBadge>
      ) : null}
      {c.features.map((f) => (
        <Link key={f.id} to="/features/$featureId" params={{ featureId: f.id }}>
          <StatusBadge tone="info">{pickLocalized(f.name, lang)}</StatusBadge>
        </Link>
      ))}
    </span>
  ),
});

const modeColumn = ({ t }: ColumnCtx): Col => ({
  id: "mode",
  header: t("commands.list.col.mode"),
  cell: (c) => <span className="font-mono text-label">{c.mode}</span>,
});

const statusColumn = ({ t, optimistic, onToggle }: ColumnCtx): Col => ({
  id: "status",
  header: t("commands.list.col.status"),
  cell: (c) => <CommandToggle command={c} optimistic={optimistic[c.id]} onToggle={onToggle} />,
});

const updatedColumn = ({ t }: ColumnCtx): Col => ({
  id: "updated",
  header: t("commands.list.col.updated"),
  cell: (c) => formatUpdated(c.updated_at, c.updated_by),
});

const actionsColumn = ({ t, onToggle, onDelete }: ColumnCtx): Col => ({
  id: "actions",
  header: <span className="sr-only">{t("common.actions")}</span>,
  className: "w-12 text-right",
  cell: (c) => <CommandRowMenu command={c} onToggle={onToggle} onDelete={onDelete} />,
});

export function buildCommandColumns(ctx: ColumnCtx): Col[] {
  return [
    nameColumn(ctx),
    descriptionColumn(ctx),
    workflowColumn(ctx),
    featureColumn(ctx),
    modeColumn(ctx),
    statusColumn(ctx),
    updatedColumn(ctx),
    actionsColumn(ctx),
  ];
}
