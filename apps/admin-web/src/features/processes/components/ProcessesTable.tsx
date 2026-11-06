// ADM-FR-65 · CR-056 · P-a F5: bảng quy trình (6 cột + hành động dòng) cho tab "Của công ty" / "Mẫu" (plan-frontend-admin §1 ①).
import { Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatUpdated } from "@/lib/format";
import { isTemplateRow, rowMode } from "../lib/library-view";
import type { LibraryListItem as Row } from "../library-api";
import { DefaultPill, StatusCell, StepsCell, UsedByCell } from "./library/LibraryListCells";
import { LibraryRowMenu } from "./library/LibraryRowMenu";
import { RowDeleteButton } from "./library/RowDeleteButton";

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
  /** Mẫu toàn nền tảng sửa được không (chỉ platform_admin); def tenant (kể cả bản "Chép mẫu") luôn sửa/chạy được. */
  canEditTemplates: boolean;
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
  /** CR-120 · thư viện chưa chọn app: tiêu đề nhóm theo app. */
  group?: { of: (row: Row) => string; label: (key: string) => React.ReactNode } | undefined;
};

const L = (t: TFunction, k: string): string => t(`process.admin.list.${k}`);

/** Thư viện: huy hiệu "Mặc định" ngắn (tên khe xuống dòng phụ bên dưới, thay cho cột "Dùng cho") ⇒ bảng vừa 1440px. */
function nameColumn(t: TFunction, library: boolean): Column<Row> {
  return {
    id: "name",
    header: L(t, "col.name"),
    className: library ? "max-w-80" : undefined,
    cell: (r) => (
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <Link
            to="/processes/$processId"
            params={{ processId: r.id }}
            title={`!${r.key}`}
            className="truncate font-medium text-primary underline-offset-4 hover:underline"
          >
            {r.name}
          </Link>
          {library && r.published_version != null ? (
            <span className="text-caption text-muted-foreground">v{r.published_version}</span>
          ) : null}
          {isTemplateRow(r) ? <StatusBadge tone="info">{L(t, "template")}</StatusBadge> : null}
          {r.is_default && !library ? (
            <DefaultPill slotLabel={r.slot_label ?? ""} short={false} />
          ) : null}
        </span>
        {library ? (
          <span className="truncate text-label text-muted-foreground">
            {r.slot_label ?? r.slot ?? "—"}
          </span>
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
      isTemplateRow(r) ? (
        <StatusBadge tone={r.enabled ? "ok" : "off"}>
          {t(r.enabled ? "common.on" : "common.off")}
        </StatusBadge>
      ) : (
        <Switch
          checked={r.enabled}
          aria-label={`${t("common.on")} ${r.name}`}
          onCheckedChange={(v) => o.actions.onToggle(r, v)}
        />
      ),
  };
}

/** Sửa · Xoá (danh sách mẫu/chạy thử; Thư viện dùng `LibraryRowMenu`); xoá bị khoá khi là mặc định của khe hoặc đang có tenant gán. */
function WriteActions(p: { t: TFunction; r: Row; actions: RowActions }) {
  const { t, r, actions } = p;
  return (
    <>
      <Button size="sm" variant="ghost" asChild>
        <Link to="/processes/$processId" params={{ processId: r.id }}>
          {L(t, "edit")}
        </Link>
      </Button>
      {/* mặc định của khe / đang có tenant gán ⇒ khoá + tooltip lý do; còn lại (nháp lẫn đã xuất bản) xoá được */}
      <RowDeleteButton row={r} label={L(t, "deleteButton")} onDelete={() => actions.onDelete(r)} />
    </>
  );
}

function actionsColumn(t: TFunction, o: Opts): Column<Row> {
  const { canEditTemplates, canRun, actions, library } = o;
  return {
    id: "actions",
    header: <span className="sr-only">{t("common.actions")}</span>,
    className: "whitespace-nowrap text-right",
    cell: (r) => (
      <span className="flex items-center justify-end gap-1">
        {rowMode(r, canEditTemplates) === "copy" ? (
          <Button size="sm" variant="outline" onClick={() => actions.onCopy(r)}>
            {L(t, "copy")}
          </Button>
        ) : null}
        {isTemplateRow(r) || library ? null : (
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
        {rowMode(r, canEditTemplates) === "full" ? (
          <WriteActions t={t} r={r} actions={actions} />
        ) : null}
      </span>
    ),
  };
}

/** CR-121 c15 (artboard Library): Quy trình · Các bước · Dùng bởi · Trạng thái · Cập nhật (+ cột thao tác Nhân bản/Xoá, không tiêu đề). */
function libraryColumns(t: TFunction, o: Opts): Column<Row>[] {
  return [
    nameColumn(t, true),
    {
      id: "stages",
      header: t("process.admin.library.col.steps"),
      className: "max-w-96",
      cell: (r) => <StepsCell row={r} />,
    },
    {
      id: "tenants",
      header: t("process.admin.library.col.tenants"),
      cell: (r) => <UsedByCell row={r} />,
    },
    {
      id: "status",
      header: t("process.admin.library.col.status"),
      cell: (r) => <StatusCell row={r} />,
    },
    { id: "updated", header: L(t, "col.updated"), cell: (r) => formatUpdated(r.updated_at, null) },
    {
      id: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      className: "whitespace-nowrap text-right",
      cell: (r) => (
        <LibraryRowMenu
          row={r}
          onClone={() => o.actions.onClone(r)}
          onDelete={() => o.actions.onDelete(r)}
        />
      ),
    },
  ];
}

export function buildColumns(t: TFunction, o: Opts): Column<Row>[] {
  if (o.library) return libraryColumns(t, o);
  const cols: Column<Row>[] = [nameColumn(t, false)];
  cols.push({
    id: "stages",
    header: L(t, "col.stages"),
    cell: (r) => r.stage_count,
    className: "text-right",
  });
  cols.push({
    id: "running",
    header: L(t, "col.running"),
    cell: (r) => r.active_runs,
    className: "text-right",
  });
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
  const { templates, canEditTemplates, canRun, actions, library } = p;
  const navigate = useNavigate();
  const columns = useMemo(
    () => buildColumns(t, { templates, canEditTemplates, canRun, actions, library }),
    [t, templates, canEditTemplates, canRun, actions, library],
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
      group={p.group}
      onRowClick={
        library
          ? (r) => void navigate({ to: "/processes/$processId", params: { processId: r.id } })
          : undefined
      }
    />
  );
}
