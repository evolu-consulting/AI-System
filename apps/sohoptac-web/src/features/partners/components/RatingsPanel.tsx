// V2-I · DT-04 · BA §5.1i: đánh giá thủ công 1–5 sao từng tiêu chí (trộn vào điểm với tỷ trọng s). Lệch hơn `reason_gap` điểm so với dữ
// liệu ⇒ bắt nhập lý do (máy chủ kiểm lại, 422). Mỗi tiêu chí lưu riêng; dưới là lịch sử đánh giá (mới nhất trước).
import type { RepCellOut, RepCriterionOut, RepGroup, RepRatingRow, RepRole } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { useRateRep, useRepConfig, useRepDetail, useRepRatings } from "../hooks/use-rep-v2e";
import { dataPointOf, needsReason } from "../lib/partner-v2e";
import { Stars } from "./Stars";

function RatingRow({
  party,
  role,
  cell,
  c,
  mine,
  gap,
  editable,
}: {
  party: string;
  role: RepRole;
  cell: RepCellOut;
  c: RepCriterionOut;
  mine: RepRatingRow | undefined;
  gap: number;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.review.${k}`, o);
  const [stars, setStars] = useState(mine?.stars ?? 0);
  const [reason, setReason] = useState("");
  const data = dataPointOf(c, cell);
  const must = stars > 0 && needsReason(stars, data, gap);
  const save = useRateRep({ onDone: () => setReason(""), onSaved: () => toast(L("saved")) });
  const unchanged = stars === (mine?.stars ?? 0);
  return (
    <div className="rounded-lg bg-sunk px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b>{c.label}</b>
        <span className="text-[12.5px] text-dim">
          {data === null ? L("noData") : L("data", { n: data })}
        </span>
        <span className="ml-auto">
          <Stars
            value={stars}
            onChange={setStars}
            label={L("starsFor", { name: c.label })}
            disabled={!editable}
          />
        </span>
      </div>
      {editable && stars > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="field h-8 min-w-[200px] flex-1"
            placeholder={must ? L("reasonRequired", { gap }) : L("reasonOptional")}
            value={reason}
            maxLength={500}
            aria-required={must}
            aria-label={L("reasonFor", { name: c.label })}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary h-8"
            disabled={save.isPending || unchanged || (must && !reason.trim())}
            onClick={() =>
              save.mutate({
                party,
                role,
                group: cell.group as RepGroup,
                criterion: c.key,
                stars,
                reason: reason.trim() || null,
              })
            }
          >
            {save.isPending ? L("saving") : L("save")}
          </button>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="mt-1 text-[12.5px] text-late">
          {L("failed")}
        </p>
      )}
    </div>
  );
}

export function RatingsPanel({ party, role }: { party: string; role: RepRole }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.pv2.review.${k}`, o);
  const { write, user } = useMe();
  const d = useRepDetail(party, role);
  const r = useRepRatings(party, role);
  const cfg = useRepConfig();
  if (d.isLoading || r.isLoading) return <Loading />;
  if (r.error) return <ErrorLine error={r.error} />;
  const cells = d.data?.groups ?? [];
  const gap = cfg.data?.settings.reason_gap ?? 25;
  const share = cfg.data?.settings.manual_share ?? 20;
  const label = new Map(
    cells.flatMap((c) => c.criteria.map((x) => [`${c.group}\u0001${x.key}`, x.label] as const)),
  );
  const mineOf = (g: string, k: string) =>
    r.data?.current.find((x) => x.group === g && x.criterion === k && x.by_user === user?.id);
  return (
    <section aria-label={L("title")} className="rounded-xl border border-rule bg-panel">
      <div className="flex flex-wrap items-baseline gap-2 px-5 py-3">
        <h3 className="text-[15px] font-semibold">{L("title")}</h3>
        <span className="text-[12.5px] text-dim">{L("share", { s: share })}</span>
      </div>
      <div className="space-y-2 px-5 pb-4">
        {cells.length === 0 && <p className="text-label text-dim">{L("noCriteria")}</p>}
        {cells.map((cell) => (
          <div key={cell.group} className="space-y-2">
            {cells.length > 1 && (
              <h4 className="text-[13px] font-semibold text-ink-2">
                {t(`contracts.pv2.group.${cell.group}`)}
              </h4>
            )}
            {cell.criteria.map((c) => (
              <RatingRow
                key={c.key}
                party={party}
                role={role}
                cell={cell}
                c={c}
                mine={mineOf(cell.group, c.key)}
                gap={gap}
                editable={write}
              />
            ))}
          </div>
        ))}
        <h4 className="pt-2 text-[13px] font-semibold text-ink-2">{L("history")}</h4>
        {(r.data?.history.length ?? 0) === 0 ? (
          <p className="text-label text-dim">{L("historyNone")}</p>
        ) : (
          <ul className="divide-y divide-rule-soft text-[13.5px]">
            {r.data?.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="w-[82px] shrink-0 font-mono text-[12.5px] text-dim">
                  {viDate(h.at)}
                </span>
                <span className="min-w-0 flex-1">
                  {h.by ?? ""} · {label.get(`${h.group}\u0001${h.criterion}`) ?? h.criterion}
                  {h.reason && <span className="block text-[12px] text-dim">“{h.reason}”</span>}
                </span>
                <span className="tnum font-semibold text-soon">
                  <span aria-hidden="true">{"★".repeat(h.stars)}</span>
                  <span className="sr-only">{L("starsN", { n: h.stars })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
