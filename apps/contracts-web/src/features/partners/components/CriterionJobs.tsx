// V2-I · DT-02: các việc góp điểm của MỘT tiêu chí — ngày, việc (HĐ), điểm việc, hệ số độ cũ h, trễ bao nhiêu ngày / lỗi của ai.
import type { RepDetailItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import type { CriterionLine } from "../lib/partner-v2";

export function CriterionJobs({
  line,
  items,
}: {
  line: CriterionLine;
  items: readonly RepDetailItem[];
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.jobs.${k}`, o);
  const rows = [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return (
    <section
      aria-label={L("title", { name: line.label })}
      className="mt-3 rounded-lg bg-sunk px-3 py-2.5"
    >
      <h4 className="mb-1.5 text-[13.5px] font-semibold">{L("title", { name: line.label })}</h4>
      {line.kind === "manual" && <p className="text-[12.5px] text-dim">{L("manual")}</p>}
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-dim">{line.kind === "manual" ? "" : L("none")}</p>
      ) : (
        <ul className="divide-y divide-rule-soft text-[13.5px]">
          {rows.map((i) => (
            <li
              key={`${i.source}:${i.id}`}
              className="flex flex-wrap items-baseline gap-x-3 py-1.5"
            >
              <span className="w-[82px] shrink-0 font-mono text-[12.5px] text-dim">
                {viDate(i.at)}
              </span>
              <span className="min-w-0 flex-1">
                {i.label}
                {i.contract_id && (
                  <>
                    {" · "}
                    <Link
                      to="/contracts/$id"
                      params={{ id: i.contract_id }}
                      className="text-act hover:underline"
                    >
                      {i.contract ?? L("contract")}
                    </Link>
                  </>
                )}
                <span className="block text-[12px] text-dim">
                  {i.source === "milestone"
                    ? (i.late_days ?? 0) > 0
                      ? L("late", { n: i.late_days, fault: L(`fault.${i.fault ?? "unknown"}`) })
                      : L("onTime")
                    : (i.note ?? L("manualJob"))}
                </span>
              </span>
              <span className="tnum w-12 text-right font-semibold">{i.score ?? "—"}</span>
              <span className="tnum w-16 text-right text-[12px] text-dim" title={L("hTip")}>
                {L("h", { h: i.h })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
