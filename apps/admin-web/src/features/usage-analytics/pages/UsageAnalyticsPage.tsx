// ADM-FR-42 · usage-analytics · màn "Phân tích token" `/usage/analytics`: lọc (tenant chỉ platform, khoảng, xô, app/agent/
// model/user/kết quả), KPI so kỳ trước, cột chồng theo app, "token đổ vào đâu" (app → agent → model + breakdown), quota
// tháng, bản ghi thô (CSV, drill-down run).
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { notifyError } from "@/components/shared/toast";
import { loadError } from "@/lib/load-error";
import { AnalyticsKpis } from "../components/AnalyticsKpis";
import { BreakdownPanel } from "../components/BreakdownPanel";
import { FilterBar } from "../components/FilterBar";
import { FlowTable } from "../components/FlowTable";
import { useAppLabel, useTierLabel } from "../components/labels";
import { QuotaSection } from "../components/QuotaSection";
import { RecordsPanel } from "../components/RecordsPanel";
import { RunSheet } from "../components/RunSheet";
import { StackedSeries } from "../components/StackedSeries";
import { UsageTabs } from "../components/UsageTabs";
import { type AnalyticsView, useAnalyticsView } from "../hooks/use-analytics-view";
import { useQuotaReport, useRecordsView } from "../hooks/use-records-view";

const route = getRouteApi("/_authed/usage_/analytics");

type Q = { isError: boolean; error: unknown; refetch: () => unknown };
function useErr() {
  const { t } = useTranslation();
  return (q: Q) =>
    q.isError
      ? {
          ...(loadError(q.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" }),
          onRetry: () => void q.refetch(),
        }
      : undefined;
}

function Breakdowns({ v }: { v: AnalyticsView }) {
  const { t } = useTranslation();
  const appLabel = useAppLabel();
  const tierLabel = useTierLabel();
  const errOf = useErr();
  const d = v.query.data;
  const common = { loading: v.query.isPending && v.ready, error: errOf(v.query) };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <BreakdownPanel
        title={t("usageAnalytics.by.app")}
        rows={d?.by_app}
        label={(r) => appLabel(r.key)}
        onPick={(k) => v.set({ app: k })}
        {...common}
      />
      <BreakdownPanel
        title={t("usageAnalytics.by.agent")}
        rows={d?.by_agent}
        onPick={(k) => v.set({ agent: k })}
        {...common}
      />
      <BreakdownPanel
        title={t("usageAnalytics.by.tier")}
        rows={d?.by_tier}
        label={(r) => tierLabel(r.key)}
        {...common}
      />
      <BreakdownPanel
        title={t("usageAnalytics.by.model")}
        rows={d?.by_model}
        onPick={(k) => v.set({ model: k })}
        {...common}
      />
      <BreakdownPanel title={t("usageAnalytics.by.feature")} rows={d?.by_feature} {...common} />
      <BreakdownPanel
        title={t("usageAnalytics.by.user")}
        rows={d?.by_user}
        onPick={(k) => v.set({ user: k })}
        {...common}
      />
    </div>
  );
}

export function UsageAnalyticsPage() {
  const { t } = useTranslation();
  const v = useAnalyticsView(route.useSearch());
  const r = useRecordsView(v.params, v.ready);
  const platformAll = v.platform && v.tenantKey === null;
  const quota = useQuotaReport(v.params.tenantId, v.ready);
  const errOf = useErr();
  if (v.notFound) return <NotFoundState backTo="/" />;
  const d = v.query.data;
  const common = { loading: v.query.isPending && v.ready, error: errOf(v.query) };
  return (
    <>
      <PageHeader
        title={t("usageAnalytics.title")}
        description={t("usageAnalytics.subtitle", { from: v.range.from, to: v.range.to })}
      />
      <UsageTabs />
      <FilterBar v={v} data={d} />
      <AnalyticsKpis data={d} platform={v.platform} {...common} />
      <div className="space-y-4">
        <StackedSeries data={d} {...common} />
        <Breakdowns v={v} />
        <FlowTable rows={d?.tree} {...common} />
        <div className="grid gap-4 lg:grid-cols-2">
          {platformAll ? (
            <BreakdownPanel
              title={t("usageAnalytics.by.tenant")}
              rows={d?.by_tenant}
              onPick={(k) =>
                v.set({ tenant: d?.by_tenant.find((x) => x.key === k)?.label ?? undefined })
              }
              {...common}
            />
          ) : null}
          <QuotaSection
            report={quota.data}
            platformAll={platformAll}
            loading={quota.isPending && v.ready}
            error={errOf(quota)}
          />
        </div>
        <RecordsPanel
          items={r.q.data?.items}
          platform={v.platform}
          loading={r.q.isPending && v.ready}
          error={errOf(r.q)}
          hasPrev={r.hasPrev}
          hasNext={r.hasNext}
          onPrev={r.prev}
          onNext={r.next}
          onCsv={() => r.csv.mutate(v.params, { onError: () => notifyError(t("usage.csvFailed")) })}
          csvPending={r.csv.isPending}
          onRun={r.openRun}
        />
      </div>
      <RunSheet
        runId={r.runId}
        data={r.run.data}
        loading={r.run.isPending && r.runId !== null}
        error={errOf(r.run)}
        onClose={r.closeRun}
      />
    </>
  );
}
