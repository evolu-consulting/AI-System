// V2-I · DT-02 · BA §5.1: bảng tính điểm của một nhóm — Tiêu chí · Điểm · Trọng số · Góp · Dữ liệu. Bấm một tiêu chí ⇒ liệt kê các việc
// góp điểm của nó (`items` của `/reputation/partner`). Tiêu chí chưa có dữ liệu bị bỏ khỏi điểm (Góp "—") và trọng số chia lại.
import type { RepCellOut, RepDetailItem } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { type CriterionLine, criterionLines } from "../lib/partner-v2e";
import { CriterionJobs } from "./CriterionJobs";

const dash = "—";
const num = (v: number | null, suffix = "") => (v === null ? dash : `${v}${suffix}`);

export function ScoreTable({ cell, items }: { cell: RepCellOut; items: readonly RepDetailItem[] }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.table.${k}`, o);
  const [open, setOpen] = useState<string | null>(null);
  const lines = criterionLines(cell.criteria);
  const on = lines.find((l) => l.key === open);
  const row = (l: CriterionLine) => (
    <tr key={l.key} className={cn("border-t border-rule-soft", open === l.key && "bg-act-soft/40")}>
      <td className="py-2 pr-3">
        <button
          type="button"
          className="text-left font-medium text-act hover:underline"
          aria-expanded={open === l.key}
          onClick={() => setOpen(open === l.key ? null : l.key)}
        >
          {l.label}
        </button>
      </td>
      <td className="tnum py-2 pr-3 text-right font-semibold">{num(l.score)}</td>
      <td className="tnum py-2 pr-3 text-right text-dim">{l.weight}%</td>
      <td className="tnum py-2 pr-3 text-right">{num(l.gives)}</td>
      <td className="py-2 text-right text-[13px] text-dim">
        {l.score === null ? L("noData") : l.kind === "manual" ? L("stars") : L("jobsN", { n: l.n })}
      </td>
    </tr>
  );
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-dim">
              <th className="pb-1.5 font-medium">{L("criterion")}</th>
              <th className="pb-1.5 text-right font-medium">{L("score")}</th>
              <th className="pb-1.5 text-right font-medium">{L("weight")}</th>
              <th className="pb-1.5 text-right font-medium">{L("gives")}</th>
              <th className="pb-1.5 text-right font-medium">{L("data")}</th>
            </tr>
          </thead>
          <tbody>{lines.map(row)}</tbody>
          <tfoot>
            <tr className="border-t border-rule font-semibold">
              <td className="py-2 pr-3">{L("dataScore")}</td>
              <td />
              <td />
              <td className="tnum py-2 pr-3 text-right">{num(cell.data_score)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {on && (
        <CriterionJobs
          line={on}
          items={items.filter((i) => i.group === cell.group && i.criterion === on.key)}
        />
      )}
    </div>
  );
}
