// ADM-FR-42 · usage-analytics · thẻ KPI: token vào/ra, chi phí ước tính (chỉ platform — server xoá cho tenant_admin), lượt
// gọi AI, run, độ trễ TB, tỉ lệ lỗi; mỗi thẻ so với kỳ liền trước cùng số ngày.
import type { UsageAnalytics, UsageAnalyticsKpi } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { KpiCard } from "@/components/shared/kpi/KpiCard";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { deltaPct, errorPct } from "../lib/view";

type Err = { message: string; code: string; onRetry?: () => void };
type Props = {
  data: UsageAnalytics | undefined;
  platform: boolean;
  loading?: boolean;
  error?: Err;
};
type Num = (k: UsageAnalyticsKpi) => number;

export function AnalyticsKpis({ data, platform, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const k = data?.kpi;
  const p = data?.previous;
  const delta = (f: Num, invert = false) => {
    if (!k || !p) return undefined;
    const d = deltaPct(f(k), f(p));
    if (d === null) return t("usageAnalytics.kpi.noPrev");
    const up = invert ? d < 0 : d > 0;
    return (
      <span className={up ? "text-foreground" : undefined}>
        {t("usageAnalytics.kpi.delta", { sign: d > 0 ? "+" : "", pct: d })}
      </span>
    );
  };
  const count = (f: Num) => (k ? formatCount(f(k), lang) : null);
  const common = { loading, error };
  const cost = k?.cost_usd;
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
      <KpiCard
        title={t("usageAnalytics.kpi.input")}
        value={count((x) => x.input_tokens)}
        note={delta((x) => x.input_tokens)}
        {...common}
      />
      <KpiCard
        title={t("usageAnalytics.kpi.output")}
        value={count((x) => x.output_tokens)}
        note={delta((x) => x.output_tokens)}
        {...common}
      />
      {platform ? (
        <KpiCard
          title={t("usageAnalytics.kpi.cost")}
          value={cost !== undefined ? formatUsd(cost, lang) : null}
          note={
            k && k.unpriced > 0
              ? t("usageAnalytics.kpi.unpriced", { n: formatCount(k.unpriced, lang) })
              : delta((x) => Number(x.cost_usd ?? 0))
          }
          {...common}
        />
      ) : null}
      <KpiCard
        title={t("usageAnalytics.kpi.calls")}
        value={count((x) => x.calls)}
        note={delta((x) => x.calls)}
        {...common}
      />
      <KpiCard
        title={t("usageAnalytics.kpi.runs")}
        value={count((x) => x.runs)}
        note={delta((x) => x.runs)}
        {...common}
      />
      <KpiCard
        title={t("usageAnalytics.kpi.latency")}
        value={
          k ? (k.avg_latency_ms === null ? "—" : `${formatCount(k.avg_latency_ms, lang)} ms`) : null
        }
        note={delta((x) => x.avg_latency_ms ?? 0, true)}
        {...common}
      />
      <KpiCard
        title={t("usageAnalytics.kpi.errors")}
        value={k ? `${errorPct(k.errors, k.calls)}%` : null}
        note={
          k ? t("usageAnalytics.kpi.errorsNote", { n: formatCount(k.errors, lang) }) : undefined
        }
        {...common}
      />
    </div>
  );
}
