// CHAT-AC-58 · P-a PF4: `table "Token theo giai đoạn"`; `detail=full` ⇒ mở rộng lượt gọi / team-run từng giai đoạn.
import type { ProcessRunUsage } from "@ai/contracts/chat";
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatSeconds, formatTokens } from "../../shared/lib/format";
import { cacheOf } from "../lib/usage-view";
import { CallsTable } from "./CallsTable";

type Stage = ProcessRunUsage["stages"][number];
const NUM = "px-2 py-1.5 text-right tabular-nums";

export function StageUsageTable({ usage }: { usage: ProcessRunUsage }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const full = usage.detail === "full";
  const toggle = (idx: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(idx)) n.add(idx);
      return n;
    });
  const heads = [
    t("process.usage.col.stage"),
    t("process.usage.col.attempts"),
    t("process.usage.col.asks"),
    t("process.usage.kpi.calls"),
    t("process.usage.kpi.in"),
    t("process.usage.kpi.out"),
    t("process.usage.kpi.cache"),
    t("process.usage.col.total"),
  ];
  const f = (n: number) => formatTokens(n, lang);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table aria-label={t("process.usage.title")} className="w-full text-body">
        <thead className="bg-muted text-caption text-muted-foreground">
          <tr>
            {heads.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`px-2 py-1.5 font-medium ${i === 0 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usage.stages.map((s) => {
            const isOpen = full && open.has(s.stage_idx);
            return (
              <Fragment key={s.stage_idx}>
                <tr className="border-t border-border">
                  <th scope="row" className="px-2 py-1.5 text-left font-normal">
                    {full ? (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={t("process.usage.expand", { name: s.name })}
                        onClick={() => toggle(s.stage_idx)}
                        className="inline-flex items-center gap-1 rounded text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <ChevronRight
                          className={`size-3.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          aria-hidden
                        />
                        {s.name}
                      </button>
                    ) : (
                      s.name
                    )}
                  </th>
                  <td className={NUM}>{f(s.attempts)}</td>
                  <td className={NUM}>{f(s.asks_count)}</td>
                  <td className={NUM}>{f(s.totals.calls)}</td>
                  <td className={NUM}>{f(s.totals.input)}</td>
                  <td className={NUM}>{f(s.totals.output)}</td>
                  <td className={NUM}>{f(cacheOf(s.totals))}</td>
                  <td className={NUM}>{f(s.totals.total)}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={heads.length} className="bg-muted/40 px-3 py-2">
                      <StageDetail stage={s} lang={lang} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/40 font-semibold">
            <th scope="row" colSpan={3} className="px-2 py-1.5 text-left">
              {t("process.usage.kpi.total")}
            </th>
            <td className={NUM}>{f(usage.totals.calls)}</td>
            <td className={NUM}>{f(usage.totals.input)}</td>
            <td className={NUM}>{f(usage.totals.output)}</td>
            <td className={NUM}>{f(cacheOf(usage.totals))}</td>
            <td className={NUM}>{f(usage.totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function StageDetail({ stage, lang }: { stage: Stage; lang: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {stage.team_runs.map((tr) => {
        const label = t("process.usage.team", {
          mode: t(`process.usage.mode.${tr.mode}`),
          status: t(`process.usage.teamStatus.${tr.status}`),
          seconds: formatSeconds(tr.active_ms, lang).replace(/s$/, ""),
        });
        return (
          <section key={tr.id} className="flex flex-col gap-1">
            <p className="text-caption font-medium">
              {label}
              {tr.stop_reason ? ` · ${tr.stop_reason}` : ""}
            </p>
            {tr.calls.length > 0 && <CallsTable label={label} calls={tr.calls} />}
          </section>
        );
      })}
      <CallsTable label={t("process.usage.calls", { name: stage.name })} calls={stage.calls} />
    </div>
  );
}
