// GAP-D2 · #27: đường xu hướng điểm 6 tháng + khối "Cảnh báo bất thường" của một đối tác ở tab Tổng quan (luật ở lib/alerts.ts).
import type { RepRole } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { todayIso } from "~/features/contract-deadline/lib/deadline";
import { useRepDetail, useRepHistory } from "../hooks/use-rep-v2e";
import { type Alert, alertsOf, sparkOf } from "../lib/alerts";
import { periodLabel, seriesOf } from "../lib/partner-v2e";

function AlertLine({ a }: { a: Alert }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.alerts.${k}`, o);
  return (
    <li className="rounded-lg bg-late-bg px-3 py-2 text-[13.5px] text-late">
      {a.kind === "score_drop"
        ? L("scoreDrop", { from: a.from, to: a.to, period: periodLabel(a.period) })
        : L("lateSpike", { recent: a.recent, base: a.base ?? 0, n: a.n })}
    </li>
  );
}

export function TrendPanel({ party, role }: { party: string; role: RepRole }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.alerts.${k}`, o);
  const h = useRepHistory(party, role, 6);
  const d = useRepDetail(party, role);
  const pts = seriesOf(h.data).slice(-6);
  const spark = sparkOf(pts);
  const alerts = alertsOf(pts, d.data?.items ?? [], todayIso());
  return (
    <section aria-label={L("trend")} className="rounded-xl border border-rule bg-panel px-5 py-4">
      <h3 className="mb-2 text-[15px] font-semibold">{L("trend")}</h3>
      {spark ? (
        <svg
          role="img"
          aria-label={L("sparkAria", { n: pts.length })}
          width="160"
          height="40"
          viewBox="0 0 160 40"
          className="text-act"
        >
          <polyline
            points={spark.path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={spark.last.x} cy={spark.last.y} r="2.8" fill="currentColor" />
        </svg>
      ) : (
        <p className="text-[13px] text-dim">{L("noTrend")}</p>
      )}
      <h4 className="mt-3 mb-1.5 text-[13.5px] font-semibold">{L("title")}</h4>
      {alerts.length ? (
        <ul className="space-y-1.5">
          {alerts.map((a) => (
            <AlertLine key={a.kind} a={a} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-dim">{L("none")}</p>
      )}
    </section>
  );
}
