// V2-I · DT-06 · tab "Hợp đồng · n": HĐ đã xác nhận của đối tác, lọc theo giai đoạn Chưa bắt đầu / Đang thực hiện / Đã xong
// (giai đoạn do máy chủ suy từ mốc — cùng luật danh sách HĐ).
import type { PartnerContractRow } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { Tag, type TagTone } from "~/components/shared/tag";
import { usePartnerContracts } from "../hooks/use-partner-rep";
import { byStage, STAGES, type StageFilter, stageCounts } from "../lib/partner-v2";
import { SEG, segItem } from "./seg-style";

function ContractRow({ c }: { c: PartnerContractRow }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.contracts.${k}`, o);
  const overdue = c.next?.overdue === true;
  return (
    <tr className="border-t border-rule-soft">
      <td className="px-5 py-2.5">
        <b className="block">{c.title}</b>
        {c.number && <span className="block text-[12.5px] text-dim">{c.number}</span>}
      </td>
      <td>{c.deal && <Tag tone={DEAL_TONE[c.deal]}>{L(`deal.${c.deal}`)}</Tag>}</td>
      <td className="tnum text-right">{c.value === null ? "—" : vnd(c.value)}</td>
      <td className="tnum px-3 whitespace-nowrap">
        {c.start_date ? viDate(c.start_date) : "—"} – {c.end_date ? viDate(c.end_date) : "—"}
      </td>
      <td>
        <Tag tone={overdue ? "late" : STAGE_TONE[c.stage]}>
          {overdue ? L("overdue") : L(`stage.${c.stage}`)}
        </Tag>
        {c.stage === "in_progress" && c.next && (
          <span className="block text-[12px] text-dim">{c.next.title}</span>
        )}
      </td>
      <td className="pr-5 text-right">
        <Link to="/contracts/$id" params={{ id: c.id }} className="btn btn-quiet h-8 text-[13px]">
          {L("view")}
        </Link>
      </td>
    </tr>
  );
}

const DEAL_TONE: Record<NonNullable<PartnerContractRow["deal"]>, TagTone> = {
  buy: "act",
  sell: "ok",
  referral: "grey",
};
const STAGE_TONE: Record<PartnerContractRow["stage"], TagTone> = {
  not_started: "grey",
  in_progress: "act",
  done: "ok",
};

export function ContractsTab({ party }: { party: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.contracts.${k}`, o);
  const [filter, setFilter] = useState<StageFilter>("all");
  const q = usePartnerContracts(party);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorLine error={q.error} />;
  const rows = q.data ?? [];
  const cnt = stageCounts(rows);
  const shown = byStage(rows, filter);
  return (
    <section aria-label={L("title")} className="rounded-xl border border-rule bg-panel">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <h3 className="text-[15px] font-semibold">{L("title")}</h3>
        <fieldset aria-label={L("stageFilter")} className={`${SEG} m-0 ml-auto`}>
          {STAGES.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              className={segItem(filter === k)}
              onClick={() => setFilter(k)}
            >
              {L(`stage.${k}`)} · {cnt[k]}
            </button>
          ))}
        </fieldset>
      </div>
      {shown.length === 0 ? (
        <Empty title={L("emptyTitle")}>{rows.length ? L("emptyFilter") : L("emptyBody")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-dim">
                <th className="px-5 pb-1.5 font-medium">{L("col.contract")}</th>
                <th className="pb-1.5 font-medium">{L("col.deal")}</th>
                <th className="pb-1.5 text-right font-medium">{L("col.value")}</th>
                <th className="px-3 pb-1.5 font-medium">{L("col.period")}</th>
                <th className="pb-1.5 font-medium">{L("col.stage")}</th>
                <th className="pr-5 pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <ContractRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
