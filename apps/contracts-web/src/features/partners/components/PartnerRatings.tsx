// HD8-FR-04 · "Chấm điểm" — port `mgmt-app/web/src/pages/partners/{PartnerRatings.tsx, PartnersPage.tsx:13-27}`: tiêu chí tự chấm
// của vai, lần chấm hiện tại, thanh trượt 0–100 bước 5 (mặc định 70); chưa có tiêu chí ⇒ chỉ đường tới Cách tính điểm.
import type { PartnerRole, PartnerRatings as Ratings } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { ErrorLine, Loading } from "~/components/shared/states";
import { toast } from "~/components/shared/toast";
import { ledgerErrorText } from "~/features/ledger/lib/use-act";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { fetchRatings, partnerKeys, ratePartner } from "../api";

type Row = Ratings["criteria"][number];

function RatingRow({
  c,
  party,
  role,
  editable,
}: {
  c: Row;
  party: string;
  role: PartnerRole;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.partners.${k}`, o);
  const qc = useQueryClient();
  const [value, setValue] = useState(c.current?.value ?? 70);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ratePartner({ party, role, criterion: c.key, value, note: note.trim() || undefined });
      setNote("");
      await qc.invalidateQueries({ queryKey: ["partners"] });
      toast(L("saved"));
    } catch (e) {
      setErr(ledgerErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const cur = c.current;
  return (
    <div className="rounded-lg bg-sunk px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <b>{c.label}</b>
        <span className="text-[12.5px] text-dim">
          {L("weight", { w: c.weight })}
          {c.enabled ? "" : L("off")}
        </span>
        <span className="ml-auto font-mono">{cur ? `${cur.value}/100` : L("notRated")}</span>
      </div>
      {cur && (
        <p className="text-[12.5px] text-dim">
          {L("ratedBy", { by: cur.by ?? "", date: viDate(cur.at) })}
          {cur.note ? ` · ${cur.note}` : ""}
          {!cur.counts && L("expired")}
        </p>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-40 accent-[var(--color-act)]"
            aria-label={L("scoreAria", { label: c.label })}
          />
          <input
            className="field h-8 w-[64px] text-right font-mono"
            inputMode="numeric"
            value={value}
            onChange={(e) =>
              setValue(Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0))
            }
            aria-label={L("scoreNumAria", { label: c.label })}
          />
          <input
            className="field h-8 min-w-[160px] flex-1"
            placeholder={L("notePlaceholder")}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            aria-label={L("noteAria", { label: c.label })}
          />
          <button
            type="button"
            className="btn btn-primary h-8"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? L("savingRating") : L("saveRating")}
          </button>
        </div>
      )}
      {err && (
        <p role="alert" className="mt-1 text-[12.5px] text-late">
          {err}
        </p>
      )}
    </div>
  );
}

export function PartnerRatings({ party, role }: { party: string; role: PartnerRole }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.partners.${k}`, o);
  const { write } = useMe();
  const q = useQuery({
    queryKey: partnerKeys.ratings(party, role),
    queryFn: ({ signal }) => fetchRatings(party, role, signal),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorLine error={q.error} />;
  if (!q.data?.criteria.length)
    return (
      <p className="text-[13px] text-dim">
        {L("noCriteria1", { role: L(`roleWord.${role}`).toLowerCase() })}{" "}
        <Link
          to="/settings/scoring"
          className="font-semibold text-act underline underline-offset-2"
        >
          {L("noCriteriaLink")}
        </Link>{" "}
        {L("noCriteria2")}
      </p>
    );
  return (
    <section className="space-y-2" aria-label={L("ratingsTitle")}>
      <h3 className="text-[14px] font-semibold">{L("ratingsTitle")}</h3>
      {q.data.criteria.map((c) => (
        <RatingRow key={c.key} c={c} party={party} role={role} editable={write} />
      ))}
    </section>
  );
}
