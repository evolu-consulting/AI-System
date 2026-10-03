// ADM-FR-42 · M4-R03 · cột số thu theo ngày, tự vẽ SVG (plan-frontend D1, không recharts).
// Chồng "Trong quota" (màu chính) + "Vượt quota" (vân chéo); mỗi cột có <title>; `role="img"` + bảng `sr-only`.
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatUsd } from "@/lib/quota-format";
import { cn } from "@/lib/utils";
import { type DayInput, layoutBars } from "./bars-geometry";

type Props = {
  days: readonly DayInput[];
  className?: string;
};

const W = 600;
const H = 160;

export function DailyBars({ days, className }: Props) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const hatch = `${uid}-hatch`;
  const layout = useMemo(() => layoutBars(days, W, H), [days]);
  const money = (n: number) => formatUsd(n, i18n.language);
  const summary = layout.peak
    ? t("usage.chart.summary", {
        total: money(layout.sum),
        max: money(layout.peak.total),
        date: layout.peak.date,
      })
    : t("usage.chart.title");

  return (
    <figure className={cn("m-0", className)}>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
      >
        <defs>
          <pattern
            id={hatch}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" fill="var(--color-overage-hatch-from)" />
            <rect width="4" height="8" fill="var(--color-overage-hatch-to)" />
          </pattern>
        </defs>
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-border" strokeWidth="1" />
        {layout.bars.map((b) => (
          <g key={b.date}>
            <title>{t("usage.chart.bar", { date: b.date, amount: money(b.total) })}</title>
            {b.hIn > 0 ? (
              <rect x={b.x} y={b.yIn} width={b.width} height={b.hIn} className="fill-primary" />
            ) : null}
            {b.hOver > 0 ? (
              <rect x={b.x} y={b.yOver} width={b.width} height={b.hOver} fill={`url(#${hatch})`} />
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
          {t("usage.chart.inQuota")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-overage-hatch-from)_0_3px,var(--color-overage-hatch-to)_3px_6px)]"
          />
          {t("usage.chart.over")}
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>{t("usage.chart.title")}</caption>
        <tbody>
          {layout.bars.map((b) => (
            <tr key={b.date}>
              <th scope="row">{b.date}</th>
              <td>
                {t("usage.chart.inQuota")}: {money(b.inQuota)}
              </td>
              <td>
                {t("usage.chart.over")}: {money(b.over)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
