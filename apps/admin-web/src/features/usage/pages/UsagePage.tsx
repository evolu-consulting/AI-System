// ADM-FR-42 · M4-R03, R07–R09 · màn Chi phí & quota `/usage` (plan-frontend §3.2): lọc Tenant/Kỳ, KPI, biểu đồ, bảng theo tenant hoặc quota tháng, top feature/user, xuất CSV.
import { getRouteApi } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { TenantPicker } from "@/components/shared/TenantPicker";
import { notifyError } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadError } from "@/lib/load-error";
import { useUsageCsv } from "../api";
import { ByTenantTable } from "../components/ByTenantTable";
import { QuotaCard } from "../components/QuotaCard";
import { TopFeatures, TopUsers } from "../components/TopLists";
import { UsageChart } from "../components/UsageChart";
import { UsageKpis } from "../components/UsageKpis";
import { useUsageView } from "../hooks/use-usage-view";
import { monthLabel } from "../lib/months";

const route = getRouteApi("/_authed/usage");

export function UsagePage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const v = useUsageView(search);
  const csv = useUsageCsv();
  const { query } = v;
  if (v.notFound) return <NotFoundState backTo="/" />;

  const err = query.isError
    ? {
        ...(loadError(query.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" }),
        onRetry: () => void query.refetch(),
      }
    : undefined;
  const loading = query.isPending;
  const report = query.data;
  const label = (m: string, i: number) =>
    i === 0 ? t("usage.current") : i === 1 ? t("usage.previous") : monthLabel(m);
  const exportCsv = () =>
    csv.mutate(v.params, { onError: () => notifyError(t("usage.csvFailed")) });
  const byTenant = v.platform && v.tenantKey === null;

  return (
    <>
      <PageHeader
        title={t("usage.title")}
        description={t("usage.subtitle", { period: monthLabel(v.month) })}
        actions={
          <>
            {v.platform ? (
              <TenantPicker tenants={v.tenants} value={v.tenantKey} onChange={v.setTenant} />
            ) : null}
            <Select value={v.month} onValueChange={v.setPeriod}>
              <SelectTrigger aria-label={t("usage.period")} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {v.months.map((m, i) => (
                  <SelectItem key={m} value={m}>
                    {label(m, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" disabled={csv.isPending} onClick={exportCsv}>
              <Download aria-hidden className="size-4" />
              {t("usage.csv")}
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <UsageKpis report={report} prevMonth={v.prevMonth} loading={loading} error={err} />
        <UsageChart report={report} loading={loading} error={err} />
        {byTenant ? (
          <ByTenantTable
            rows={report && "tenants" in report ? report.tenants : undefined}
            loading={loading}
            error={err}
          />
        ) : (
          <QuotaCard quotas={report?.quotas} loading={loading} error={err} />
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <TopFeatures rows={report?.top_features} loading={loading} error={err} />
          <TopUsers rows={report?.top_users} loading={loading} error={err} />
        </div>
      </div>
    </>
  );
}
