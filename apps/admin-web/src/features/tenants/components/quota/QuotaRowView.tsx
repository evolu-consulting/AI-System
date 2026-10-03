// ADM-FR-40 · một hàng của bảng quota: phạm vi · 3 ô số (spinbutton "Số run · Kế toán") · nút Bỏ · thanh đã dùng.
import type { QuotaStatus } from "@ai/contracts";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QuotaBar } from "@/components/shared/quota/QuotaBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { QUOTA_FIELDS, type QuotaField, type QuotaRow, validateCell } from "../../lib/quota-draft";

type Props = {
  row: QuotaRow;
  rowIndex: number;
  /** Trạng thái đã lưu của hàng (đã dùng + giới hạn) hoặc `undefined` với hàng mới. */
  status: QuotaStatus | undefined;
  touched: boolean;
  onChange: (field: QuotaField, value: string) => void;
  onBlur: () => void;
  onRemove?: () => void;
};

const STEP: Record<QuotaField, string> = { runs: "1", tokens: "1", usd: "0.01" };
const BAR_KIND = { runs: "runs", tokens: "tokens", usd: "usd" } as const;

function UsedBars({ row, status }: { row: QuotaRow; status: QuotaStatus | undefined }) {
  const scope = row.key ? row.name : null;
  const lbl = (base: string) => (scope ? `${base} · ${scope}` : base);
  const used = {
    runs: status?.used.runs ?? 0,
    tokens: status?.used.tokens ?? 0,
    usd: status?.used.billable_usd ?? "0",
  };
  const limit = {
    runs: status?.max_runs ?? null,
    tokens: status?.max_tokens ?? null,
    usd: status?.max_usd ?? null,
  };
  const names = { runs: "Run", tokens: "Token", usd: "USD" } as const;
  const set = QUOTA_FIELDS.filter((f) => limit[f] !== null);
  if (set.length === 0) {
    return (
      <QuotaBar
        label={lbl(names.runs)}
        kind="runs"
        used={used.runs}
        limit={null}
        showLabel={false}
      />
    );
  }
  return (
    <div className="space-y-2">
      {set.map((f) => (
        <QuotaBar
          key={f}
          label={lbl(names[f])}
          kind={BAR_KIND[f]}
          used={used[f]}
          limit={limit[f]}
        />
      ))}
    </div>
  );
}

export function QuotaRowView({
  row,
  rowIndex,
  status,
  touched,
  onChange,
  onBlur,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const scopeLabel = row.key ? row.name : t("tenants.quota.scope.tenant");
  const fieldName = {
    runs: t("tenants.quota.col.runs"),
    tokens: t("tenants.quota.col.tokens"),
    usd: t("tenants.quota.col.usd"),
  };
  return (
    <TableRow className="align-top">
      <TableCell className="font-medium">{scopeLabel}</TableCell>
      {QUOTA_FIELDS.map((f) => {
        const err = touched ? validateCell(f, row[f]) : undefined;
        const id = `quota-${rowIndex}-${f}`;
        return (
          <TableCell key={f}>
            <Input
              id={id}
              type="number"
              min={0}
              step={STEP[f]}
              inputMode={f === "usd" ? "decimal" : "numeric"}
              value={row[f]}
              placeholder={t("common.unlimited")}
              aria-label={t("tenants.quota.cell", { field: fieldName[f], scope: scopeLabel })}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? `${id}-err` : undefined}
              onChange={(e) => onChange(f, e.target.value)}
              onBlur={onBlur}
              className="w-36"
            />
            {err ? (
              <p id={`${id}-err`} className="mt-1 text-caption text-destructive">
                {t(err)}
              </p>
            ) : null}
          </TableCell>
        );
      })}
      <TableCell className="min-w-56">
        <UsedBars row={row} status={status} />
      </TableCell>
      <TableCell className="w-10">
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("tenants.quota.remove", { feature: row.name })}
            onClick={onRemove}
          >
            <X aria-hidden className="size-4" />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
