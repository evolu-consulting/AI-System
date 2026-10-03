// ADM-FR-42 · M4-R06, R08 · bảng "Theo tenant" (platform_admin, Tất cả tenant): số run, token, số thu, chi phí thật, mức quota; tên tenant link tới tab Quota.
import type { UsageReportPlatform } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Panel } from "@/features/overview/components/Panel";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { cn } from "@/lib/utils";

type Row = UsageReportPlatform["tenants"][number];
type Props = {
  rows: Row[] | undefined;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
};

function Quota({ row }: { row: Row }) {
  const { t, i18n } = useTranslation();
  if (row.quota_pct === null) {
    return (
      <span className="text-muted-foreground">
        {t("usage.byTenant.noQuota", { used: formatUsd(row.billable_usd, i18n.language) })}
      </span>
    );
  }
  const pct = row.quota_pct;
  const over = pct > 100 ? t("quota.badge.overPct", { pct: pct - 100 }) : t("quota.badge.over");
  const text =
    row.level === "over" ? over : row.level === "warn" ? t("quota.badge.warn", { pct }) : `${pct}%`;
  return (
    <span
      className={cn(
        row.level === "over" && "text-danger",
        row.level === "warn" && "text-warning",
        row.level === "none" && "text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

const COLS = ["tenant", "runs", "tokens", "billable", "cost", "quota"] as const;

export function ByTenantTable({ rows, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <Panel title={t("usage.byTenant.title")} loading={loading} error={error}>
      {rows?.length ? (
        <table aria-label={t("usage.byTenant.title")} className="w-full text-body">
          <thead>
            <tr className="text-left text-caption text-muted-foreground">
              {COLS.map((c) => (
                <th key={c} scope="col" className="pb-2 font-medium">
                  {t(`usage.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenant_id} className="border-t">
                <td className="py-2">
                  <Link
                    to="/tenants/$tenantId"
                    params={{ tenantId: r.tenant_id }}
                    search={{ tab: "quota" }}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.tenant_name}{" "}
                    <span className="font-mono text-muted-foreground">{r.tenant_key}</span>
                  </Link>
                </td>
                <td className="py-2">{formatCount(r.runs, i18n.language)}</td>
                <td className="py-2">{formatCount(r.tokens, i18n.language)}</td>
                <td className="py-2">{formatUsd(r.billable_usd, i18n.language)}</td>
                <td className="py-2">{formatUsd(r.cost_usd, i18n.language)}</td>
                <td className="py-2">
                  <Quota row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-body text-muted-foreground">{t("usage.empty.rows")}</p>
      )}
    </Panel>
  );
}
