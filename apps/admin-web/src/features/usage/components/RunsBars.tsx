// Xu hướng lượt chạy theo ngày cho tenant_admin (không tiền, 2026-10-21): cột SVG đơn giản, mỗi cột có <title>.
import { useTranslation } from "react-i18next";
import { formatCount } from "@/lib/quota-format";

type Day = { date: string; runs: number };
const W = 600;
const H = 160;

export function RunsBars({ days }: { days: readonly Day[] }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...days.map((d) => d.runs));
  const w = W / Math.max(1, days.length);
  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={t("usage.unit.runs")}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
      >
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-border" strokeWidth="1" />
        {days.map((d, i) => {
          const h = (d.runs / max) * (H - 4);
          return (
            <g key={d.date}>
              <title>{`${d.date}: ${formatCount(d.runs, i18n.language)}`}</title>
              <rect
                x={i * w + w * 0.1}
                y={H - h}
                width={w * 0.8}
                height={h}
                className="fill-primary"
              />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
