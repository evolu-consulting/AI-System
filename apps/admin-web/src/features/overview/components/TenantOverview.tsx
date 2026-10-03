// ADM-FR-41 · M4-R06, R09 · Tổng quan tenant_admin (ms §1, artboard TenantOverview): 4 KPI, người dùng mới chưa đăng nhập, thay đổi gần đây.
import type { OverviewResponse } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { KpiCard } from "@/components/shared/kpi/KpiCard";
import type { LoadError } from "@/lib/load-error";
import { formatCount } from "@/lib/quota-format";
import { NeverLoggedIn } from "./NeverLoggedIn";
import { RecentChanges } from "./RecentChanges";
import { TenantQuotaCard } from "./TenantQuotaCard";

type Tenant = Extract<OverviewResponse, { kind: "tenant" }>;
type Props = {
  data: Tenant | undefined;
  loading: boolean;
  error: (LoadError & { onRetry?: () => void }) | null;
};

/** `+12` / `-5` so với tháng trước; không có tháng trước (null hoặc 0) → không hiện. */
export function runsDelta(
  cur: number | null,
  prev: number | null,
): { sign: string; pct: number } | null {
  if (cur === null || prev === null || prev === 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { sign: pct >= 0 ? "+" : "-", pct: Math.abs(pct) };
}

export function TenantOverview({ data, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  const n = (v: number) => formatCount(v, i18n.language);
  const delta = data ? runsDelta(data.runs_month, data.runs_prev_month) : null;
  const common = { loading, error: error ?? undefined };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t("overview.kpi.activeUsers")}
          value={data ? n(data.active_users) : ""}
          {...common}
        />
        <KpiCard title={t("overview.kpi.groups")} value={data ? n(data.groups) : ""} {...common} />
        <KpiCard
          title={t("overview.kpi.runsMonth")}
          value={data ? (data.runs_month === null ? null : n(data.runs_month)) : ""}
          note={delta ? t("overview.kpi.delta", delta) : undefined}
          {...common}
        />
        <TenantQuotaCard quotas={data?.quotas} loading={loading} error={error} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <NeverLoggedIn
          users={data?.never_logged_in}
          total={data?.never_logged_in_total ?? 0}
          loading={loading}
          error={error}
        />
        <RecentChanges
          items={data?.recent_changes}
          emptyKey="overview.recent.empty"
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
}
