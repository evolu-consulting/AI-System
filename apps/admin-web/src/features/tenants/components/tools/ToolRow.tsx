// ADM-FR-73 · P-d2 (plan-frontend-d2 §12; mockup 02 C1–C5): cột của bảng "Tool quy trình" — Tên · Ký hiệu · Ghi chú · Bật bởi · công tắc.
import type { TenantWorkflowTool } from "@ai/contracts";
import type { Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Translate } from "@/lib/format";

/** "Tên · ngày" khi đang bật; "—" khi chưa từng bật / đã tắt (`granted_*` null). */
export function grantedLabel(t: Translate, row: TenantWorkflowTool, locale: string): string {
  if (row.granted_at === null || row.granted_by === null) return "—";
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(row.granted_at),
  );
  return t("tenants.tools.grantedBy", { name: row.granted_by, date });
}

function Notes({ row, t }: { row: TenantWorkflowTool; t: Translate }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {row.side_effect ? (
        <StatusBadge tone="warn">{t("tenants.tools.sideEffect")}</StatusBadge>
      ) : null}
      {row.enabled ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <StatusBadge tone="off">{t("tenants.tools.workflowOff")}</StatusBadge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("tenants.tools.workflowOffTip")}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

export function toolColumns(
  t: Translate,
  locale: string,
  pendingId: string | null,
  onToggle: (row: TenantWorkflowTool, want: boolean) => void,
): Column<TenantWorkflowTool>[] {
  return [
    { id: "name", header: t("tenants.tools.col.name"), cell: (r) => r.name },
    {
      id: "key",
      header: t("tenants.tools.col.key"),
      cell: (r) => <span className="font-mono text-label">{r.key}</span>,
    },
    { id: "note", header: t("tenants.tools.col.note"), cell: (r) => <Notes row={r} t={t} /> },
    {
      id: "grantedBy",
      header: t("tenants.tools.col.grantedBy"),
      cell: (r) => grantedLabel(t, r, locale),
    },
    {
      id: "on",
      header: t("tenants.tools.col.on"),
      className: "w-40",
      cell: (r) => (
        <Switch
          aria-label={t("tenants.tools.switchAria", { name: r.name })}
          checked={r.on}
          disabled={pendingId === r.workflow_id}
          onCheckedChange={(want) => onToggle(r, want)}
        />
      ),
    },
  ];
}
