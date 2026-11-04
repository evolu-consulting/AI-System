// V2-N · 4 con số của Tổng quan (mockup NITI `kpiPanel`) + chọn kỳ: Doanh thu / Hoa hồng (thực nhận, % dự kiến, chưa thu/nhận, % so kỳ trước),
// Lãi gộp (biên %), Hàng đang giữ. Dữ liệu `GET /overview?period=`; người dùng chỉ thấy phần của HĐ mình được xem (API tự lọc).
import type { OverviewFigure, OverviewOut, OverviewPeriod } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { changeView, moneyShort, pctOf } from "../lib/overview";

export function Delta({ pct, cmp }: { pct: number | null; cmp?: string }) {
  const d = changeView(pct);
  if (!d) return null;
  return (
    <span
      title={cmp}
      data-testid="delta"
      className={`tnum text-[12.5px] font-semibold ${d.up ? "text-ok" : "text-late"}`}
    >
      {d.up ? "▲" : "▼"} {d.n}%
    </span>
  );
}

function Two({
  label,
  wait,
  f,
  cmp,
}: {
  label: string;
  wait: string;
  f: OverviewFigure;
  cmp: string;
}) {
  const { t } = useTranslation();
  const pct = pctOf(f.actual, f.expected);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-rule bg-panel px-4 py-3">
      <span className="text-label text-dim">{t("contracts.overview.kpi.received", { label })}</span>
      <b className="tnum text-[22px] leading-tight font-semibold">{moneyShort(f.actual)}</b>
      <div
        role="img"
        aria-label={t("contracts.overview.kpi.pctAria", { n: pct })}
        className="h-1.5 overflow-hidden rounded-full bg-sunk"
      >
        <i className="block h-full bg-act" style={{ width: `${pct}%` }} />
      </div>
      <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-dim">
        <span>
          {t("contracts.overview.kpi.ofExpected", { n: pct })}{" "}
          <span className="tnum">{moneyShort(f.expected)}</span>
        </span>
        {f.outstanding > 0 && (
          <span className="text-soon">
            · {wait} {moneyShort(f.outstanding)}
          </span>
        )}
        <Delta pct={f.change_pct} cmp={cmp} />
      </span>
    </div>
  );
}

function Tile({
  label,
  value,
  delta,
  sub,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-rule bg-panel px-4 py-3">
      <span className="text-label text-dim">{label}</span>
      <b className="tnum text-[22px] leading-tight font-semibold">{value}</b>
      <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-dim">
        {delta}
        {sub && <span>{sub}</span>}
      </span>
    </div>
  );
}

export function KpiBlock({
  data,
  loading,
  error,
  period,
}: {
  data: OverviewOut | undefined;
  loading: boolean;
  error: unknown;
  period: OverviewPeriod;
}) {
  const { t } = useTranslation();
  if (loading) return <Loading />;
  if (error || !data) return <ErrorLine error={error} />;
  const cmp = t(`contracts.overview.period.cmp.${period}`);
  const g = data.gross_profit;
  return (
    <div
      className="grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-sm:grid-cols-1"
      data-testid="kpis"
    >
      <Two
        label={t("contracts.overview.kpi.revenue")}
        wait={t("contracts.overview.kpi.unpaid")}
        f={data.revenue}
        cmp={cmp}
      />
      <Tile
        label={t("contracts.overview.kpi.profit")}
        value={moneyShort(g.amount)}
        delta={<Delta pct={g.change_pct} cmp={cmp} />}
        sub={
          g.margin_pct != null
            ? t("contracts.overview.kpi.margin", { n: Math.round(g.margin_pct) })
            : undefined
        }
      />
      <Two
        label={t("contracts.overview.kpi.commission")}
        wait={t("contracts.overview.kpi.unreceived")}
        f={data.commission}
        cmp={cmp}
      />
      <Tile
        label={t("contracts.overview.kpi.held")}
        value={moneyShort(data.stock_held.value)}
        sub={t("contracts.overview.kpi.heldSub")}
      />
      {g.cost_missing && (
        <p className="col-span-full text-[12.5px] text-soon">
          {t("contracts.overview.kpi.costMissing")}
        </p>
      )}
    </div>
  );
}
