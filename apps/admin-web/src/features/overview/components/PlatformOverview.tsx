// ADM-FR-42 · M4-R09 · Q5 · Tổng quan platform_admin (artboard Main): 5 KPI, tenant sắp vượt quota, card Hub "—", thay đổi gần đây.
import type { OverviewResponse } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { KpiCard } from "@/components/shared/kpi/KpiCard";
import { Button } from "@/components/ui/button";
import type { LoadError } from "@/lib/load-error";
import { formatCount } from "@/lib/quota-format";
import { HubCards } from "./HubCards";
import { NearQuotaCard } from "./NearQuotaCard";
import { RecentChanges } from "./RecentChanges";

type Platform = Extract<OverviewResponse, { kind: "platform" }>;
type Props = {
  data: Platform | undefined;
  loading: boolean;
  error: (LoadError & { onRetry?: () => void }) | null;
};

export function PlatformActions() {
  const { t } = useTranslation();
  return (
    <>
      <Button asChild variant="outline">
        <Link to="/commands/new">{t("overview.platform.createCommand")}</Link>
      </Button>
      <Button asChild>
        <Link to="/tenants/new">{t("overview.platform.createTenant")}</Link>
      </Button>
    </>
  );
}

export function PlatformOverview({ data, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  const v = (x: number | undefined) => (x === undefined ? "" : formatCount(x, i18n.language));
  const common = { loading, error: error ?? undefined };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title={t("overview.kpi.activeTenants")}
          value={v(data?.tenants_active)}
          {...common}
        />
        <KpiCard
          title={t("overview.kpi.enabledCommands")}
          value={v(data?.commands_enabled)}
          {...common}
        />
        <KpiCard
          title={t("overview.kpi.workflows")}
          value={v(data?.workflows_total)}
          note={data ? t("overview.kpi.unattached", { n: data.workflows_unattached }) : undefined}
          {...common}
        />
        <KpiCard title={t("overview.kpi.activeUsers")} value={v(data?.users_active)} {...common} />
        <KpiCard
          title={t("overview.kpi.runs24h")}
          value={data?.runs_24h === null ? null : v(data?.runs_24h)}
          {...common}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <NearQuotaCard rows={data?.quota_tenants} loading={loading} error={error} />
        <div className="space-y-4">
          <HubCards />
        </div>
      </div>
      <RecentChanges
        items={data?.recent_changes}
        emptyKey="overview.recent.emptyPlatform"
        loading={loading}
        error={error}
      />
    </div>
  );
}
