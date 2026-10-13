// HUB-FR-78 · D9 · một ô ma trận: `switch "{agent} × {tenant}"` + nút "Chi tiết …" hiện "{n} grant"; ô không áp dụng hiện "—".
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "#/components/ui/switch";
import { TableCell } from "#/components/ui/table";
import { cn } from "#/lib/utils";

export type CellView = {
  agentId: string;
  tenantId: string;
  agentKey: string;
  tenantKey: string;
  on: boolean;
  count: number;
  /** Key tenant duy nhất được dùng agent (Orchestrator riêng) khi ô không áp dụng; `null` = áp dụng. */
  onlyFor: string | null;
  dim: boolean;
};

type Props = CellView & {
  onToggle: (v: CellView, next: boolean) => void;
  onOpen: (v: CellView) => void;
};

function AccessCellImpl({ onToggle, onOpen, ...v }: Props) {
  const { t } = useTranslation();
  const names = { agent: v.agentKey, tenant: v.tenantKey };
  if (v.onlyFor !== null) {
    return (
      <TableCell className={cn(v.dim && "opacity-60")}>
        <span className="text-muted-foreground" title={t("access.cell.na", { tenant: v.onlyFor })}>
          —
        </span>
      </TableCell>
    );
  }
  return (
    <TableCell className={cn(v.dim && "opacity-60")}>
      <div className="flex min-h-11 items-center gap-2">
        <Switch
          checked={v.on}
          aria-label={t("access.cell.label", names)}
          onCheckedChange={(next) => onToggle(v, next)}
        />
        {v.on ? (
          <button
            type="button"
            className="rounded-sm text-label text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={t("access.drawer.title", names)}
            onClick={() => onOpen(v)}
          >
            {t("access.cell.count", { n: v.count })}
          </button>
        ) : null}
      </div>
    </TableCell>
  );
}

/** Memo theo dữ liệu ô (plan-frontend §7); `onToggle`/`onOpen` phải ổn định. */
export const AccessCell = memo(AccessCellImpl);
