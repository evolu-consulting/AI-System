// ADM-FR-42 · M4-R03 · card "Số thu theo ngày": DailyBars với số thu/ngày và phần vượt quota.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DailyBars } from "@/components/shared/chart/DailyBars";
import { Panel } from "@/components/shared/panel/Panel";
import type { UsageReport } from "../lib/types";
import { RunsBars } from "./RunsBars";

type Props = {
  report: UsageReport | undefined;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
};

export function UsageChart({ report, loading, error }: Props) {
  const { t } = useTranslation();
  const days = useMemo(
    () =>
      (report?.daily ?? []).flatMap((d) => {
        const m = d as { billable_usd?: string; overage_billable_usd?: string };
        return m.billable_usd === undefined
          ? []
          : [{ date: d.date, total: m.billable_usd, over: m.overage_billable_usd ?? "0" }];
      }),
    [report],
  );
  // tenant_admin: không có tiền ⇒ xu hướng theo lượt/ngày.
  const runs = (report?.daily ?? []).map((d) => ({ date: d.date, runs: d.runs }));
  const moneyless = report !== undefined && days.length === 0 && runs.length > 0;
  return (
    <Panel title={t("usage.chart.title")} loading={loading} error={error}>
      {report && !report.has_data ? (
        <p className="text-body text-muted-foreground">{t("usage.empty.noData")}</p>
      ) : report && report.kpi.runs === 0 && report.kpi.tokens === 0 ? (
        <p className="text-body text-muted-foreground">{t("usage.empty.period")}</p>
      ) : moneyless ? (
        <RunsBars days={runs} />
      ) : (
        <DailyBars days={days} />
      )}
    </Panel>
  );
}
