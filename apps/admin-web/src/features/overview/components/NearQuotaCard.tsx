// ADM-FR-42 · M4-R06 · card "Tenant sắp hoặc đã vượt quota" (top 5 theo %): tên tenant, % run, trạng thái.
import type { OverviewResponse } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import type { LoadError } from "@/lib/load-error";
import { cn } from "@/lib/utils";

type Platform = Extract<OverviewResponse, { kind: "platform" }>;
type Props = {
  rows: Platform["quota_tenants"] | undefined;
  loading?: boolean;
  error?: (LoadError & { onRetry?: () => void }) | null;
};

export const NEAR_QUOTA_ROWS = 5;

function Status({ level, pct }: { level: "none" | "warn" | "over"; pct: number }) {
  const { t } = useTranslation();
  if (level === "over") {
    return (
      <span className="text-danger">
        {pct > 100 ? t("quota.badge.overPct", { pct: pct - 100 }) : t("quota.badge.over")}
      </span>
    );
  }
  if (level === "warn")
    return <span className="text-warning">{t("quota.badge.warn", { pct })}</span>;
  return <span className={cn("text-muted-foreground")}>{t("overview.nearQuota.ok")}</span>;
}

export function NearQuotaCard({ rows, loading, error }: Props) {
  const { t } = useTranslation();
  const top = [...(rows ?? [])].sort((a, b) => b.pct - a.pct).slice(0, NEAR_QUOTA_ROWS);
  return (
    <Panel title={t("overview.nearQuota.title")} loading={loading} error={error}>
      {top.length ? (
        <table className="w-full text-body">
          <thead>
            <tr className="text-left text-caption text-muted-foreground">
              <th scope="col" className="pb-2 font-medium">
                {t("overview.nearQuota.col.tenant")}
              </th>
              <th scope="col" className="pb-2 font-medium">
                {t("overview.nearQuota.col.quota")}
              </th>
              <th scope="col" className="pb-2 font-medium">
                {t("overview.nearQuota.col.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.tenant_id} className="border-t">
                <th scope="row" className="py-2 text-left font-medium">
                  {r.tenant_name}
                </th>
                <td className="py-2">{r.pct}%</td>
                <td className="py-2">
                  <Status level={r.level} pct={r.pct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-body text-muted-foreground">{t("overview.nearQuota.empty")}</p>
      )}
    </Panel>
  );
}
