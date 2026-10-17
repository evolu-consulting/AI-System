import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import { ratePartner, usePartnerRatings, type PartnerRatings as Ratings, type Role } from "@/api/partners";
import { canWrite, useMe } from "@/api/session";
import { viDate } from "@/components/ui";
import { toast } from "@/components/toast";

type Row = Ratings["criteria"][number];

/** Criteria the owner added to the scoring of this role, each rated 0–100 by a person; the latest rating counts.
 * Renders nothing when the role has no such criterion. */
export default function PartnerRatings({ companyId, role }: { companyId: string; role: Role }) {
  const q = usePartnerRatings(companyId, role);
  const { data: me } = useMe();
  if (!q.data?.criteria.length) return null;
  return (
    <section className="space-y-2" aria-label="Điểm tự chấm">
      <h3 className="text-[14px] font-semibold">Điểm tự chấm</h3>
      {q.data.criteria.map((c) => <RatingRow key={c.key} c={c} companyId={companyId} role={role} editable={canWrite(me)} />)}
    </section>
  );
}

function RatingRow({ c, companyId, role, editable }: { c: Row; companyId: string; role: Role; editable: boolean }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(c.current?.value ?? 70);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await ratePartner(companyId, { role, criterion: c.key, value, note: note.trim() || undefined });
      setNote("");
      await qc.invalidateQueries({ queryKey: ["partners"] });
      toast("Đã lưu điểm");
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  const cur = c.current;
  return (
    <div className="rounded-lg bg-sunk px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <b>{c.label}</b>
        <span className="text-[12.5px] text-dim">trọng số {c.weight}%{c.enabled ? "" : " · đang tắt"}</span>
        <span className="ml-auto font-mono">{cur ? `${cur.value}/100` : "chưa chấm"}</span>
      </div>
      {cur && (
        <p className="text-[12.5px] text-dim">
          {cur.by} chấm ngày {viDate(cur.at)}{cur.note ? ` · ${cur.note}` : ""}
          {!cur.counts && " · đã quá khoảng thời gian tính điểm, không còn được tính"}
        </p>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="range" min={0} max={100} step={5} value={value} onChange={(e) => setValue(Number(e.target.value))}
            className="w-40 accent-[var(--color-act)]" aria-label={`Điểm ${c.label}`} />
          <input className="field h-8 w-[64px] text-right font-mono" inputMode="numeric" value={value}
            onChange={(e) => setValue(Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0))} aria-label={`Điểm ${c.label} (số)`} />
          <input className="field h-8 min-w-[160px] flex-1" placeholder="Ghi chú (không bắt buộc)" value={note} maxLength={500}
            onChange={(e) => setNote(e.target.value)} aria-label={`Ghi chú ${c.label}`} />
          <button type="button" className="btn btn-primary h-8" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu điểm"}</button>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-[12.5px] text-late">{err}</p>}
    </div>
  );
}
