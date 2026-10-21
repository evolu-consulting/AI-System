// V2-I · DT-03 · biểu đồ diễn biến điểm 3 / 6 / 12 tháng: điểm các tháng đã chốt + hiện tại, hai đường ngưỡng KHÁ / TỐT (ngưỡng đang cấu
// hình). SVG thuần theo mockup NITI (`chartSVG`); rê chuột / bàn phím không cần — mỗi điểm có `<title>`.
import type { RepHistory, RepRole } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorLine, Loading } from "~/components/shared/states";
import { useRepHistory } from "../hooks/use-partner-rep";
import { chartOf, periodLabel, RANGES, type Range, seriesOf } from "../lib/partner-v2";
import { SEG, segItem } from "./seg-style";

function Chart({ h }: { h: RepHistory }) {
  const { t } = useTranslation();
  const pts = seriesOf(h);
  if (pts.length === 0)
    return <p className="px-5 py-6 text-label text-dim">{t("contracts.pv2.chart.empty")}</p>;
  const c = chartOf(pts, h.thresholds);
  const every = pts.length > 6 ? 2 : 1;
  return (
    <svg
      viewBox={`0 0 ${c.w} ${c.h}`}
      role="img"
      aria-label={t("contracts.pv2.chart.aria", { n: h.months })}
      className="h-auto w-full"
    >
      {c.grid.map((g) => (
        <g key={g}>
          <line x1={34} x2={c.w - 12} y1={c.y(g)} y2={c.y(g)} className="stroke-rule-soft" />
          <text x={28} y={c.y(g) + 4} textAnchor="end" className="fill-dim text-[10px]">
            {g}
          </text>
        </g>
      ))}
      {c.lines.map((l) => (
        <g key={l.label} data-testid={`threshold-${l.label}`}>
          <line
            x1={34}
            x2={c.w - 12}
            y1={l.y}
            y2={l.y}
            strokeDasharray="5 4"
            className={l.label === "good" ? "stroke-ok" : "stroke-soon"}
          />
          <text
            x={40}
            y={l.y - 5}
            className={`text-[10px] ${l.label === "good" ? "fill-ok" : "fill-soon"}`}
          >
            {t(`contracts.pv2.chart.${l.label}`)} {l.at}
          </text>
        </g>
      ))}
      {c.dots.map((d, i) =>
        i % every === 0 || i === c.dots.length - 1 ? (
          <text
            key={d.period}
            x={d.x}
            y={c.h - 8}
            textAnchor="middle"
            className="fill-dim text-[10px]"
          >
            {periodLabel(d.period)}
          </text>
        ) : null,
      )}
      <polyline
        points={c.path}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-act"
      />
      {c.dots.map((d, i) => (
        <circle
          key={d.period}
          cx={d.x}
          cy={d.y}
          r={i === c.dots.length - 1 ? 4.5 : 3}
          className="fill-act"
        >
          <title>{`${periodLabel(d.period)}: ${d.score}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function HistoryChart({
  party,
  role,
  range,
}: {
  party: string;
  role: RepRole;
  range: Range;
}) {
  const { t } = useTranslation();
  const q = useRepHistory(party, role, range);
  return (
    <section
      aria-label={t("contracts.pv2.chart.title")}
      className="rounded-xl border border-rule bg-panel"
    >
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <h3 className="text-[15px] font-semibold">{t("contracts.pv2.chart.title")}</h3>
        <span role="tablist" className={`${SEG} ml-auto`}>
          {RANGES.map((r) => (
            <Link
              key={r}
              to="/partners"
              search={{ party, role, ...(r === 12 ? {} : { range: r }) }}
              role="tab"
              aria-selected={range === r}
              className={segItem(range === r)}
            >
              {t(`contracts.pv2.chart.range.${r}`)}
            </Link>
          ))}
        </span>
      </div>
      <div className="px-3 pb-3">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorLine error={q.error} />
        ) : (
          q.data && <Chart h={q.data} />
        )}
      </div>
    </section>
  );
}
