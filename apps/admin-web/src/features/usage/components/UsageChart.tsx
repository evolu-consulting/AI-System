// ADM-FR-42 · M4-R03 · card "Số thu theo ngày": DailyBars với số thu/ngày và phần vượt quota.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DailyBars } from "@/components/shared/chart/DailyBars";
import { Panel } from "@/components/shared/panel/Panel";
import type { UsageReport } from "../lib/types";

type Props = {
  report: UsageReport | undefined;
  loading?: boolean;
  error?: { message: string; code: string; onRetry?: () => void };
};

export function UsageChart({ report, loading, error }: Props) {
  const { t } = useTranslation();
  const days = useMemo(
    () =>
      (report?.daily ?? []).map((d) => ({
        date: d.date,
        total: d.billable_usd,
        over: d.overage_billable_usd,
      })),
    [report],
  );
  return (
    <Panel title={t("usage.chart.title")} loading={loading} error={error}>
      {report && !report.has_data ? (
        <p className="text-body text-muted-foreground">{t("usage.empty.noData")}</p>
      ) : report && report.kpi.runs === 0 && report.kpi.tokens === 0 ? (
        <p className="text-body text-muted-foreground">{t("usage.empty.period")}</p>
      ) : (
        <DailyBars days={days} />
      )}
    </Panel>
  );
}
