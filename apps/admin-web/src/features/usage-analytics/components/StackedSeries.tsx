// ADM-FR-42 · usage-analytics · biểu đồ cột chồng token theo xô thời gian × app (SVG tự vẽ như DailyBars, không thư viện):
// mỗi đoạn có <title>; `role="img"` + bảng `sr-only` cho trình đọc màn hình; chú giải màu theo app.
import type { UsageAnalytics } from "@ai/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { formatCount } from "@/lib/quota-format";
import { colorAt, stackOf } from "../lib/view";
import { useAppLabel } from "./labels";

type Err = { message: string; code: string; onRetry?: () => void };
type Props = { data: UsageAnalytics | undefined; loading?: boolean; error?: Err };

const W = 720;
const H = 200;
const GAP = 0.2;

export function StackedSeries({ data, loading, error }: Props) {
  const { t, i18n } = useTranslation();
  const appLabel = useAppLabel();
  const s = useMemo(() => stackOf(data?.series ?? []), [data]);
  const n = (v: number) => formatCount(v, i18n.language);
  const slot = s.buckets.length ? W / s.buckets.length : W;
  const bw = slot * (1 - GAP);
  const scale = (v: number) => (s.max ? (v / s.max) * (H - 8) : 0);
  const title = t("usageAnalytics.chart.title");
  return (
    <Panel title={title} loading={loading} error={error}>
      {s.max === 0 ? (
        <p className="text-body text-muted-foreground">{t("usageAnalytics.empty")}</p>
      ) : (
        <figure className="m-0">
          <svg
            role="img"
            aria-label={t("usageAnalytics.chart.summary", {
              max: n(s.max),
              buckets: s.buckets.length,
            })}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-52 w-full"
          >
            <line x1="0" x2={W} y1={H} y2={H} className="stroke-border" strokeWidth="1" />
            {s.buckets.map((b, i) => {
              let y = H;
              return (
                <g key={b}>
                  {s.values[i]?.map((v, j) => {
                    const h = scale(v);
                    y -= h;
                    if (h <= 0) return null;
                    const app = s.apps[j] as string;
                    return (
                      <rect
                        key={app}
                        x={i * slot + (slot - bw) / 2}
                        y={y}
                        width={bw}
                        height={h}
                        fill={colorAt(j)}
                      >
                        <title>{`${b} · ${appLabel(app)} · ${n(v)}`}</title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <div className="mt-1 flex justify-between text-caption text-muted-foreground">
            <span>{s.buckets[0]}</span>
            <span>{s.buckets[s.buckets.length - 1]}</span>
          </div>
          <figcaption className="mt-2 flex flex-wrap gap-4 text-caption text-muted-foreground">
            {s.apps.map((a, j) => (
              <span key={a} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ background: colorAt(j) }}
                />
                {appLabel(a)}
              </span>
            ))}
          </figcaption>
          <table className="sr-only">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t("usageAnalytics.col.bucket")}</th>
                {s.apps.map((a) => (
                  <th key={a} scope="col">
                    {appLabel(a)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.buckets.map((b, i) => (
                <tr key={b}>
                  <th scope="row">{b}</th>
                  {s.values[i]?.map((v, j) => (
                    <td key={s.apps[j]}>{n(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}
    </Panel>
  );
}
