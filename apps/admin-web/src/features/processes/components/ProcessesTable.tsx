// ADM-FR-65 · CR-056 · P-a F5: bảng quy trình (6 cột + hành động dòng) cho tab "Của công ty" / "Mẫu" (plan-frontend-admin §1 ①).
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatUpdated } from "@/lib/format";
import { inUseReason, tenantUsage } from "../lib/library-view";
import type { LibraryListItem as Row } from "../library-api";

export type RowActions = {
  onToggle: (row: Row, enabled: boolean) => void;
  onRun: (row: Row) => void;
  onDelete: (row: Row) => void;
  onCopy: (row: Row) => void;
  /** CR-105 · Nhân bản quy trình thư viện ⇒ nháp mới cùng khe, chưa gán. */
  onClone: (row: Row) => void;
};

type Opts = {
  templates: boolean;
  canWrite: boolean;
  canRun: boolean;
  /** CR-105 · danh sách thư viện (platform_admin): thêm cột Dùng cho / Tenant đang dùng. */
  library?: boolean;
  actions: RowActions;
};
type Props = Opts & {
  rows: Row[] | undefined;
  loading: boolean;
  fetching: boolean;
  error: { message: string; code: string } | null;
  onRetry: () => void;
  empty: React.ReactNode;
};

const L = (t: TFunction, k: string): string => t(`process.admin.list.${k}`);

function nameColumn(t: TFunction): Column<Row> {
  return {
    id: "name",
    header: L(t, "col.name"),
    cell: (r) => (
      <span className="flex items-center gap-2">
        <Link
          to="/processes/$processId"
          params={{ processId: r.id }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {r.name}
        </Link>
        {r.is_template ? <StatusBadge tone="info">{L(t, "template")}</StatusBadge> : null}
        {r.is_default ? (
          <StatusBadge tone="ok">
            {t("process.admin.library.defaultBadge", { slot: r.slot_label ?? "" })}
          </StatusBadge>
        ) : null}
      </span>
    ),
  };
}

function enabledColumn(t: TFunction, o: Opts): Column<Row> {
  return {
    id: "enabled",
    header: L(t, "col.enabled"),
    cell: (r) =>
      o.templates ? (
        <StatusBadge tone={r.enabled ? "ok" : "off"}>
          {t(r.enabled ? "common.on" : "common.off")}
        </StatusBadge>
      ) : (
        <Switch
          checked={r.enabled}
          disabled={!o.canWrite}
          aria-label={`${t("common.on")} ${r.name}`}
          onCheckedChange={(v) => o.actions.onToggle(r, v)}
        />
      ),
  };
}

/** Sửa · (Nhân bản — thư viện) · Xoá; xoá bị khoá khi là mặc định của khe hoặc đang có tenant gán. */
function WriteActions(p: {
  t: TFunction;
  r: Row;
  library?: boolean | undefined;
  actions: RowActions;
}) {
  const { t, r, actions } = p;
  const reason = inUseReason(r);
  return (
    <>
      <Button size="sm" variant="ghost" asChild>
        <Link to="/processes/$processId" params={{ processId: r.id }}>
          {L(t, "edit")}
        </Link>
      </Button>
      {p.library ? (
        <Button size="sm" variant="ghost" onClick={() => actions.onClone(r)}>
          {t("process.admin.library.clone.button")}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={reason !== null}
        title={reason ? t(`process.admin.library.inUse.${reason}`) : undefined}
        onClick={() => actions.onDelete(r)}
      >
        {L(t, "deleteButton")}
      </Button>
    </>
  );
}

function actionsColumn(t: TFunction, o: Opts): Column<Row> {
  const { templates, canWrite, canRun, actions, library } = o;
  return {
    id: "actions",
    header: <span className="sr-only">{t("common.actions")}</span>,
    className: "text-right",
    cell: (r) => (
      <span className="flex items-center justify-end gap-1">
        {templates && !canWrite ? (
          <Button size="sm" variant="outline" onClick={() => actions.onCopy(r)}>
            {L(t, "copy")}
          </Button>
        ) : null}
        {templates ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={!r.enabled || !canRun}
            title={canRun ? undefined : L(t, "run.platform")}
            onClick={() => actions.onRun(r)}
          >
            {L(t, "run.button")}
          </Button>
        )}
        {canWrite ? <WriteActions t={t} r={r} library={library} actions={actions} /> : null}
      </span>
    ),
  };
}

/** CR-105 · cột thư viện: "Dùng cho" (khe) + "Tenant đang dùng" (số tenant gán; mặc định áp cho tenant chưa gán). */
function libraryColumns(t: TFunction): Column<Row>[] {
  return [
    {
      id: "slot",
      header: t("process.admin.library.col.usedFor"),
      cell: (r) => r.slot_label ?? r.slot ?? "—",
    },
    {
      id: "tenants",
      header: t("process.admin.library.col.tenants"),
      className: "text-right",
      cell: (r) => {
        const u = tenantUsage(r);
        return u.isDefault
          ? t("process.admin.library.col.tenantsDefault", { n: u.count })
          : u.count;
      },
    },
  ];
}

export function buildColumns(t: TFunction, o: Opts): Column<Row>[] {
  const cols: Column<Row>[] = [
    nameColumn(t),
    {
      id: "key",
      header: L(t, "col.key"),
      cell: (r) => <span className="font-mono text-label">!{r.key}</span>,
    },
    {
      id: "stages",
      header: L(t, "col.stages"),
      cell: (r) => r.stage_count,
      className: "text-right",
    },
  ];
  if (o.library) cols.push(...libraryColumns(t));
  if (!o.templates) {
    cols.push({
      id: "running",
      header: L(t, "col.running"),
      cell: (r) => r.active_runs,
      className: "text-right",
    });
  }
  cols.push({
    id: "updated",
    header: L(t, "col.updated"),
    cell: (r) => formatUpdated(r.updated_at, null),
  });
  cols.push(enabledColumn(t, o), actionsColumn(t, o));
  return cols;
}

export function ProcessesTable(p: Props) {
  const { t } = useTranslation();
  const { templates, canWrite, canRun, actions, library } = p;
  const columns = useMemo(
    () => buildColumns(t, { templates, canWrite, canRun, actions, library }),
    [t, templates, canWrite, canRun, actions, library],
  );
  return (
    <DataTable
      caption={L(t, "col.name")}
      columns={columns}
      rows={p.rows}
      getRowKey={(r) => r.id}
      isLoading={p.loading}
      isFetching={p.fetching}
      error={p.error}
      onRetry={p.onRetry}
      empty={p.empty}
    />
  );
}
