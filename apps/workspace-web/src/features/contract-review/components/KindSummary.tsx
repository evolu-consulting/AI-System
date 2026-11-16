// CR-152 · bản mẫu nq-chitiet / ht-chitiet: khối tóm tắt HĐ Nhượng quyền / Thỏa thuận hợp tác (phí ban đầu · phí định kỳ · còn hiệu lực, hoặc
// cách chia), danh sách kỳ (số đã ghi, phí / phần chia) và nút ghi doanh thu / đối soát kỳ (quyền như sửa mốc: không có quyền ⇒ ẩn nút).

import type { ContractDetail, KindTermsView } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel, Stat } from "~/components/shared/layout";
import { isKind, monthsLeft } from "~/features/contract-form/lib/kind-terms";
import { fetchKindTerms, kindTermsKey } from "../api";
import { openPeriods, PeriodDialog } from "./PeriodDialog";

const money = (v: unknown): string => (typeof v === "number" ? `${vnd(v)} đ` : "—");
type L = (k: string, o?: Record<string, unknown>) => string;

function Stats({ v, left, L }: { v: KindTermsView; left: number | null; L: L }) {
  const tm = v.terms;
  const per = L(`per.${String(v.deal === "franchise" ? tm.period : tm.settle_period)}`);
  if (v.deal === "franchise")
    return (
      <>
        <Stat value={money(tm.initial_fee)} label={L("initialFee")} />
        <Stat
          value={
            tm.fee_basis === "fixed"
              ? L("feeFixed", { v: money(tm.fee_fixed), per })
              : L("feePct", { v: String(tm.fee_pct ?? "—"), per })
          }
          label={L("recurringFee")}
        />
        <Stat value={left === null ? "—" : L("monthsLeft", { n: left })} label={L("inForce")} />
      </>
    );
  if (tm.split_basis === "none") return <p className="text-[13px] text-dim">{L("noSplit")}</p>;
  const ours = Number(tm.our_share_pct ?? 0);
  return (
    <>
      <Stat value={L(`basis.${String(tm.split_basis)}`)} label={L("splitBasis")} />
      <Stat value={`${ours}% / ${100 - ours}%`} label={L("shares")} />
      <Stat value={per} label={L("settlePeriod")} />
    </>
  );
}

function Periods({ v, L }: { v: KindTermsView; L: L }) {
  if (v.periods.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-rule-soft text-[13px]" data-testid="kind-periods">
      {v.periods.map((p) => (
        <li key={p.key} className="flex flex-wrap items-center gap-x-4 py-2">
          <span className="w-32 font-medium">{p.label}</span>
          <span className="font-mono">
            {p.figure === null ? L("notRecorded") : `${vnd(p.figure)} đ`}
          </span>
          {p.fee && <span className="text-dim">{L("fee", { v: money(p.fee.amount) })}</span>}
          {p.our_share !== null && (
            <span className="text-dim">
              {L("ourShare", { our: vnd(p.our_share), partner: vnd(p.partner_share ?? 0) })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function KindSummary({
  c,
  write,
  today,
}: {
  c: ContractDetail;
  write: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const on = isKind(c.deal);
  const q = useQuery({
    queryKey: kindTermsKey(c.id),
    queryFn: ({ signal }) => fetchKindTerms(c.id, signal),
    enabled: on,
    staleTime: 15_000,
  });
  if (!on || c.status === "draft") return null;
  const L: L = (k, o) => t(`contracts.kinds.sum.${k}`, o);
  if (!q.data)
    return q.isError ? (
      <p role="alert" className="mb-4 text-[13px] text-late">
        {L("error")}
      </p>
    ) : (
      <p className="mb-4 text-[13px] text-dim">{L("loading")}</p>
    );
  const v = q.data;
  const franchise = v.deal === "franchise";
  const left = monthsLeft(today, String(c.fields.end_date?.value ?? "") || null);
  const can = write && !c.locked && openPeriods(v).length > 0;
  return (
    <div className="mb-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{L(`title.${v.deal}`)}</h2>
          {can && (
            <Button variant="primary" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
              {L(franchise ? "recordFranchise" : "recordCoop")}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3"
            data-testid="kind-stats"
          >
            <Stats v={v} left={left} L={L} />
          </div>
          <Periods v={v} L={L} />
        </div>
        {open && <PeriodDialog id={c.id} view={v} onClose={() => setOpen(false)} />}
      </Panel>
    </div>
  );
}
