// CR-127 · U5 · M9: 4 ô số · thẻ "Điều cần lưu ý" · thẻ "Cần chú ý" · thẻ "Hiệu lực" (thay "Hạn chót hành động / Ghi nhận xử lý" và "Tóm tắt hợp đồng").
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel, Stat } from "~/components/shared/layout";
import { listPenalties, penaltiesKey } from "~/features/contract-milestones/api-exec";
import { pctOf, progressStats } from "~/features/contract-milestones/lib/milestone-rows";
import { EffectChip } from "~/features/contract-shared/components/Chips";
import { daysUntil } from "~/features/contract-shared/lib/date";
import { citeOf, noticeGroups, risksOf, termKey } from "../lib/notice-view";

export function StatsRow({ c, today }: { c: ContractDetail; today: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.u5.stats.${k}`, o);
  const pens = useQuery({
    queryKey: penaltiesKey(c.id),
    queryFn: ({ signal }) => listPenalties(c.id, signal),
    staleTime: 15_000,
  });
  const s = progressStats(c.milestones);
  const next = c.milestones.find((m) => m.id === c.next_milestone_id && m.status === "open");
  const nextDays = next ? daysUntil(next.due_date, today) : null;
  const booked = (pens.data?.items ?? []).filter((x) => x.decision === "booked");
  const hasDelivery = s.qtyTotal > 0;
  const hasMoney = s.moneyTotal > 0;
  if (!hasDelivery && !hasMoney && !next) return null;
  return (
    <div
      className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3"
      data-testid="stats-row"
    >
      {hasDelivery && (
        <Stat
          value={`${s.qtyDone} / ${s.qtyTotal}`}
          label={L("delivered", { pct: pctOf(s.qtyDone, s.qtyTotal), left: s.deliveriesLeft })}
        />
      )}
      {hasMoney && (
        <Stat
          value={`${vnd(s.moneyDone)} / ${vnd(s.moneyTotal)}`}
          label={L("collected", { pct: pctOf(s.moneyDone, s.moneyTotal), left: s.collectsLeft })}
        />
      )}
      {next && (
        <Stat
          value={<span className="text-[15px] leading-snug font-semibold">{next.title}</span>}
          label={L("next", { date: viDate(next.due_date), n: nextDays ?? 0 })}
          {...(nextDays !== null && nextDays < 0 ? { tone: "late" as const } : {})}
        />
      )}
      {booked.length > 0 && (
        <Stat
          value={vnd(booked.reduce((a, x) => a + (x.estimate?.amount ?? 0), 0))}
          label={L("penalty")}
          tone="soon"
        />
      )}
    </div>
  );
}

export function NoticeCards({ c }: { c: ContractDetail }) {
  const { t } = useTranslation();
  const groups = noticeGroups(c);
  const risks = risksOf(c);
  if (groups.length === 0 && risks.length === 0) return null;
  return (
    <>
      {groups.length > 0 && (
        <Panel className="px-5 py-4">
          <h2 className="mb-2 text-[15px] font-semibold" data-testid="notes-title">
            {t("contracts.u5.notes.title")}{" "}
            <span className="text-caption font-normal text-dim">
              · {t("contracts.u5.notes.sub")}
            </span>
          </h2>
          {groups.map((g) => (
            <div
              key={g.group}
              className="flex flex-col gap-0.5 border-t border-rule py-2.5 first:border-t-0 first:pt-0"
              data-testid="notes-group"
              data-group={g.group}
            >
              <b className="text-[13px]">{t(`contracts.u5.notes.group.${g.group}`)}</b>
              {g.terms.map((x) => {
                const k = termKey(x);
                return (
                  <p key={x.id} className="text-[13px]">
                    {t(`contracts.u5.notes.term.${k.key}`, {
                      defaultValue: t("contracts.u5.notes.term.generic", { rate: k.rate }),
                      rate: k.rate,
                      cap: k.cap ?? "",
                    })}
                    {k.cap && ` ${t("contracts.u5.notes.cap", { cap: k.cap })}`}
                    {citeOf(x) && <span className="text-caption text-act"> · {citeOf(x)}</span>}
                  </p>
                );
              })}
              {g.notes.map((n) => (
                <p key={n.text} className="text-[13px]">
                  {n.text}
                  {citeOf(n) && <span className="text-caption text-act"> · {citeOf(n)}</span>}
                </p>
              ))}
            </div>
          ))}
        </Panel>
      )}
      {risks.length > 0 && (
        <Panel className="px-5 py-4">
          <h2 className="mb-2 text-[15px] font-semibold" data-testid="risks-title">
            {t("contracts.u5.risks.title")}{" "}
            <span className="text-caption font-normal text-dim">{risks.length}</span>
          </h2>
          <ul className="flex flex-col gap-1.5">
            {risks.map((r) => (
              <li
                key={`${r.kind}${r.text}`}
                className="text-[13px] text-soon"
                data-testid="risk-row"
              >
                ⚠ <span className="text-ink">{r.text}</span>
                {citeOf(r) && <span className="text-caption text-act"> · {citeOf(r)}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/** Thẻ "Hiệu lực": chỉ HĐ DONE. Kết cục Gia hạn/Chấm dứt/Để hết hạn quyết trong việc "Sắp hết hạn" (quy trình), thẻ nói rõ trạng thái + bước kế. */
export function EffectCard({ c, today }: { c: ContractDetail; today: string }) {
  const { t } = useTranslation();
  if (c.status !== "done" || !c.effect) return null;
  const left = daysUntil(c.end_date, today);
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.u5.effectCard.${k}`, o);
  return (
    <Panel className="px-5 py-4">
      <h2
        className="mb-2 flex flex-wrap items-center gap-2 text-[15px] font-semibold"
        data-testid="effect-card"
      >
        {L("title")} <EffectChip effect={c.effect} daysLeft={left} />
      </h2>
      <p className="text-[13px] text-dim">
        {c.end_date ? L("until", { date: viDate(c.end_date) }) : L("noEnd")}
        {c.effect_outcome &&
          c.effect_outcome_at &&
          ` · ${L(c.effect_outcome, { date: viDate(c.effect_outcome_at) })}`}
      </p>
      <p className="mt-1 text-caption text-dim">{L(`hint.${c.effect}`)}</p>
    </Panel>
  );
}
