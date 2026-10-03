// ADM-FR-42 · M4-R08, R09 · hàng KPI: Số run · Token · Số thu (+ delta so với kỳ trước), "Chi phí thật" và "Biên" CHỈ khi response có khoá (server đã loại cho tenant_admin).
import { useTranslation } from "react-i18next";
import { KpiCard } from "@/components/shared/kpi/KpiCard";
import { formatCount, formatUsd } from "@/lib/quota-format";
import { deltaPct, monthLabel } from "../lib/months";
import type { UsageReport } from "../lib/types";

type Err = { message: string; code: string; onRetry?: () => void };
type Common = { loading?: boolean; error?: Err };
type Props = Common & { report: UsageReport | undefined; prevMonth: string };
type Kpi = UsageReport["kpi"];

function useDelta(prevMonth: string, has: boolean) {
  const { t } = useTranslation();
  return (cur: number | undefined, before: number | undefined) => {
    if (!has || cur === undefined || before === undefined) return undefined;
    const pct = deltaPct(cur, before);
    if (pct === null) return undefined;
    return t("usage.kpi.delta", { sign: pct > 0 ? "+" : "", pct, prev: monthLabel(prevMonth) });
  };
}

function CostKpis({ kpi, has, ...common }: Common & { kpi: Kpi; has: boolean }) {
  const { t, i18n } = useTranslation();
  if (!("cost_usd" in kpi)) return null;
  const money = (v: string) => formatUsd(v, i18n.language);
  const billable = Number(kpi.billable_usd);
  const pct = billable ? Math.round((Number(kpi.margin_usd) / billable) * 100) : null;
  return (
    <>
      <KpiCard title={t("usage.kpi.cost")} value={has ? money(kpi.cost_usd) : null} {...common} />
      <KpiCard
        title={t("usage.kpi.margin")}
        value={has ? money(kpi.margin_usd) : null}
        note={has && pct !== null ? t("usage.kpi.marginPct", { pct }) : undefined}
        {...common}
      />
    </>
  );
}

export function UsageKpis({ report, prevMonth, ...common }: Props) {
  const { t, i18n } = useTranslation();
  const has = report?.has_data ?? false;
  const kpi = report?.kpi;
  const prev = report?.previous;
  const delta = useDelta(prevMonth, has);
  const count = (n: number | undefined) =>
    has && n !== undefined ? formatCount(n, i18n.language) : null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <KpiCard
        title={t("usage.kpi.runs")}
        value={count(kpi?.runs)}
        note={delta(kpi?.runs, prev?.runs)}
        {...common}
      />
      <KpiCard
        title={t("usage.kpi.tokens")}
        value={count(kpi?.tokens)}
        note={delta(kpi?.tokens, prev?.tokens)}
        {...common}
      />
      <KpiCard
        title={t("usage.kpi.billable")}
        value={has && kpi ? formatUsd(kpi.billable_usd, i18n.language) : null}
        note={delta(kpi && Number(kpi.billable_usd), prev && Number(prev.billable_usd))}
        {...common}
      />
      {kpi ? <CostKpis kpi={kpi} has={has} {...common} /> : null}
    </div>
  );
}
