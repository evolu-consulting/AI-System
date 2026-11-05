// CR-120 · MỘT dòng quy trình của trang "Quy trình": tên · khi nào chạy · nguồn (Platform cung cấp / Công ty tạo) · trạng thái
// (Đang dùng / Tắt) · mở. Platform cung cấp ⇒ chỉ xem sơ đồ (+ tenant_admin sửa LUẬT chọn ở Cài đặt của Sổ Hợp Tác);
// Công ty tạo ⇒ đủ Bật/tắt · Chạy · Sửa · Xoá như trước.
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { FlowRow } from "../../lib/flows-view";
import { RowDeleteButton } from "../library/RowDeleteButton";
import type { RowActions } from "../ProcessesTable";
import { EditRulesLink } from "./EditRulesLink";
import { FlowWhenText } from "./FlowWhenText";

const FlowDiagram = lazy(() => import("./FlowDiagram"));
const k = (s: string) => `process.admin.flows.${s}`;

export type FlowItemProps = {
  row: FlowRow;
  tid: string;
  deptName: (id: string) => string;
  actions: RowActions;
  canRun: boolean;
  /** tenant_admin sửa luật chọn ở app Sổ Hợp Tác (platform sửa ở trang công ty). */
  canEditRules: boolean;
};

function PlatformActions({
  row,
  tid,
  canEditRules,
}: Pick<FlowItemProps, "row" | "tid" | "canEditRules">) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="flex items-center justify-end gap-1">
        {canEditRules && row.slot === "contracts.approval" ? <EditRulesLink /> : null}
        {row.outside ? null : (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={open}
            data-testid={`flows-diagram-${row.id}`}
            onClick={() => setOpen(!open)}
          >
            {t(k(open ? "hideDiagram" : "viewDiagram"))}
          </Button>
        )}
      </span>
      {open && row.slot ? (
        <div className="col-span-full">
          <Suspense fallback={null}>
            <FlowDiagram tid={tid} slot={row.slot} defId={row.id} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}

function CompanyActions({
  row,
  actions,
  canRun,
}: Pick<FlowItemProps, "row" | "actions" | "canRun">) {
  const { t } = useTranslation();
  const own = row.own;
  if (!own) return null;
  return (
    <span className="flex items-center justify-end gap-1">
      <Switch
        checked={own.enabled}
        aria-label={`${t("common.on")} ${own.name}`}
        onCheckedChange={(v) => actions.onToggle(own, v)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!own.enabled || !canRun}
        title={canRun ? undefined : t("process.admin.list.run.platform")}
        onClick={() => actions.onRun(own)}
      >
        {t("process.admin.list.run.button")}
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link to="/processes/$processId" params={{ processId: own.id }}>
          {t("process.admin.list.edit")}
        </Link>
      </Button>
      <RowDeleteButton
        row={own}
        label={t("process.admin.list.deleteButton")}
        onDelete={() => actions.onDelete(own)}
      />
    </span>
  );
}

export function FlowItem(p: FlowItemProps) {
  const { t } = useTranslation();
  const { row } = p;
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-md border border-border p-3"
      data-testid={`flows-row-${row.id}`}
      data-source={row.source}
      data-status={row.status}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          {row.own ? (
            <Link
              to="/processes/$processId"
              params={{ processId: row.id }}
              className="truncate font-medium text-primary underline-offset-4 hover:underline"
            >
              {row.name}
            </Link>
          ) : (
            <b className="truncate text-label">{row.name}</b>
          )}
          {row.version !== null && row.source === "platform" ? (
            <span className="text-caption text-muted-foreground">v{row.version}</span>
          ) : null}
          <StatusBadge tone={row.source === "platform" ? "info" : "off"}>
            {t(k(`source.${row.source}`))}
          </StatusBadge>
          <StatusBadge tone={row.status === "on" ? "ok" : "off"}>
            <span data-testid={`flows-status-${row.id}`}>{t(k(`status.${row.status}`))}</span>
          </StatusBadge>
        </span>
        <FlowWhenText row={row} deptName={p.deptName} />
      </div>
      {row.source === "platform" ? (
        <PlatformActions row={row} tid={p.tid} canEditRules={p.canEditRules} />
      ) : (
        <CompanyActions row={row} actions={p.actions} canRun={p.canRun} />
      )}
    </li>
  );
}
