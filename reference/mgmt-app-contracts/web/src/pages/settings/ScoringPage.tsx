import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import { CRITERIA, previewScoring, saveScoring, useScoring, useScoringHistory, type Preview, type Role, type ScoreConfig } from "@/api/partners";
import { isOwner, useMe } from "@/api/session";
import { ErrorLine, Loading, PageHead, Panel, viDate } from "@/components/ui";
import { confirmDialog } from "@/components/dialog";
import { toast } from "@/components/toast";

type Draft = Pick<ScoreConfig, "criteria" | "rules">;
const MAX_CRITERIA = 12;
const toInt = (s: string) => Math.min(100, Number(s.replace(/\D/g, "")) || 0);

/** p06 · Cách tính điểm uy tín: criteria with weights summing to 100 (built-ins removed / restored, hand-rated ones
 * picked from a list), shared rules, a preview before saving. */
/** Bands low to high, to say whether a partner goes up or down (no band yet ranks lowest). */
const RANK: Record<string, number> = { watch: 1, fair: 2, good: 3 };

export default function ScoringPage() {
  const [role, setRole] = useState<Role>("customer");
  const { data: me } = useMe();
  const q = useScoring(role);
  const hist = useScoringHistory(role);
  const qc = useQueryClient();
  const [d, setD] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newWeight, setNewWeight] = useState(10);
  const owner = isOwner(me);

  useEffect(() => { if (q.data) setD({ criteria: q.data.criteria, rules: q.data.rules }); setPreview(null); }, [q.data]);

  const total = d?.criteria.filter((c) => c.enabled).reduce((s, c) => s + c.weight, 0) ?? 0;
  const dirty = !!q.data && JSON.stringify(d) !== JSON.stringify({ criteria: q.data.criteria, rules: q.data.rules });

  // The preview follows the draft (debounced): what each partner's score becomes if this were saved.
  useEffect(() => {
    if (!d || !dirty || total !== 100) return setPreview(null);
    const t = setTimeout(() => previewScoring(role, d).then(setPreview).catch(() => setPreview(null)), 400);
    return () => clearTimeout(t);
  }, [d, dirty, total, role]);

  if (q.isLoading || !d) return q.error ? <ErrorLine error={q.error} /> : <Loading />;

  const setC = (i: number, patch: Partial<Draft["criteria"][number]>) =>
    setD({ ...d, criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setR = (patch: Partial<Draft["rules"]>) => setD({ ...d, rules: { ...d.rules, ...patch } });
  const remove = (i: number) => setD({ ...d, criteria: d.criteria.filter((_, j) => j !== i) });
  const full = d.criteria.length >= MAX_CRITERIA;
  // built-ins not in the draft: removed before (server list) or just now (still in the saved config)
  const have = new Set(d.criteria.map((c) => c.key));
  const restorable = [
    ...(q.data?.criteria ?? []).filter((c) => c.kind === "auto").map((c) => ({ key: c.key, label: c.label, weight: c.weight })),
    ...(q.data?.restorable ?? []),
  ].filter((r, i, all) => !have.has(r.key) && all.findIndex((x) => x.key === r.key) === i);
  const restore = (key: string) => {
    const r = restorable.find((x) => x.key === key);
    if (r) setD({ ...d, criteria: [...d.criteria, { key: r.key, kind: "auto", label: r.label, enabled: true, weight: r.weight }] });
  };
  // hand-rated criteria come from the server's list (no free text); the server gives each its fixed key
  const labels = new Set(d.criteria.map((c) => c.label));
  const choices = (q.data?.manual_choices ?? []).filter((x) => !labels.has(x));
  const add = () => {
    setD({ ...d, criteria: [...d.criteria, { key: "", kind: "manual", label: newLabel, enabled: true, weight: newWeight }] });
    setNewLabel("");
  };

  async function save() {
    setBusy(true);
    setErr(null);
    try { await saveScoring(role, d!); await qc.invalidateQueries(); toast("Đã lưu & tính lại điểm"); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  const numField = "field w-[72px] text-right font-mono";

  return (
    <>
      <PageHead crumb={<Link to="/partners" className="hover:underline">← Đối tác</Link>} title="Cách tính điểm uy tín"
        lead="Chỉ quản lý được chỉnh. Mọi thay đổi đều được lưu lịch sử."
        actions={owner && <button type="button" className="btn btn-primary" disabled={!dirty || total !== 100 || busy} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu & tính lại điểm"}</button>} />

      <div role="tablist" className="mb-4 inline-flex rounded-lg bg-idle-bg p-1">
        {(["customer", "supplier"] as Role[]).map((r) => (
          <button key={r} role="tab" type="button" aria-selected={role === r} onClick={() => setRole(r)}
            className={`h-9 rounded-md px-4 text-sm ${role === r ? "bg-panel font-semibold shadow-sm" : "text-dim"}`}>
            {r === "customer" ? "Khách hàng" : "Nhà cung cấp"}
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mb-3 text-sm text-late">{err}</p>}

      <Panel className="mb-4">
        <div className="flex items-center border-b border-rule px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Tiêu chí & trọng số</h2>
          <span className={`ml-auto text-sm font-semibold ${total === 100 ? "text-ok" : "text-late"}`}>
            Tổng <span className="font-mono">{total}%</span> {total === 100 ? "✓" : "· cần đúng 100%"}
          </span>
        </div>
        {d.criteria.map((c, i) => {
          const hint = c.kind === "manual" ? "Tự chấm: mỗi đối tác được chấm 0–100 ở trang đối tác" : CRITERIA[c.key]?.hint ?? "";
          const name = c.label || CRITERIA[c.key]?.label || c.key;
          return (
            <div key={c.key || c.label} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,180px)_auto_auto] items-center gap-4 border-b border-rule-soft px-5 py-3 last:border-0 max-sm:grid-cols-[auto_1fr_auto_auto]">
              <input type="checkbox" checked={c.enabled} disabled={!owner} onChange={(e) => setC(i, { enabled: e.target.checked })}
                className="h-5 w-5 accent-[var(--color-act)]" aria-label={`Bật ${name}`} />
              <span className="min-w-0">
                <span className="block font-semibold">{name}</span>
                <span className="block text-[12.5px] text-dim">
                  {c.kind === "manual" && <span className="mr-1.5 rounded bg-idle-bg px-1.5 py-px text-[11.5px]">Tự chấm</span>}
                  {hint}
                </span>
              </span>
              <span className="h-2 rounded-full bg-idle-bg max-sm:hidden">
                <span className="block h-2 rounded-full bg-act" style={{ width: `${c.enabled ? c.weight : 0}%` }} />
              </span>
              <label className="flex items-center gap-1.5 text-sm text-dim">
                <input className={numField} inputMode="numeric" value={c.weight} disabled={!owner || !c.enabled}
                  onChange={(e) => setC(i, { weight: toInt(e.target.value) })} aria-label={`Trọng số ${name}`} />%
              </label>
              {owner ? (
                <button type="button" className="btn h-8 px-2 text-[13px] text-late" aria-label={`Xoá ${name}`}
                  onClick={async () => { if (await confirmDialog({ title: `Xoá tiêu chí “${name}”?`,
                    body: c.kind === "manual"
                      ? "Điểm đã chấm vẫn được giữ trong lịch sử nhưng không còn được tính. Thay đổi chỉ áp dụng sau khi Lưu."
                      : "Có thể khôi phục lại từ danh sách tiêu chí có sẵn. Thay đổi chỉ áp dụng sau khi Lưu.",
                    confirmLabel: "Xoá tiêu chí", danger: true })) remove(i); }}>Xoá</button>
              ) : <span />}
            </div>
          );
        })}
        {owner && (
          <div className="flex flex-wrap items-end gap-3 border-t border-rule px-5 py-3.5 text-sm">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1"><span className="text-dim">Thêm tiêu chí tự chấm</span>
              <select className="field h-9" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                disabled={!choices.length}>
                <option value="">{choices.length ? "Chọn tiêu chí…" : "Đã thêm hết các tiêu chí có sẵn"}</option>
                {choices.map((x) => <option key={x} value={x}>{x}</option>)}
              </select></label>
            <label className="flex flex-col gap-1"><span className="text-dim">Trọng số</span>
              <span className="flex items-center gap-1.5"><input className={numField} inputMode="numeric" value={newWeight}
                onChange={(e) => setNewWeight(toInt(e.target.value))} aria-label="Trọng số tiêu chí mới" />%</span></label>
            <button type="button" className="btn h-9" disabled={!newLabel.trim() || full} onClick={add}>+ Thêm tiêu chí tự chấm</button>
            {restorable.length > 0 && (
              <select className="field h-9 ml-auto" value="" disabled={full} aria-label="Khôi phục tiêu chí có sẵn"
                onChange={(e) => restore(e.target.value)}>
                <option value="">Khôi phục tiêu chí có sẵn…</option>
                {restorable.map((r) => <option key={r.key} value={r.key}>{r.label} ({r.weight}%)</option>)}
              </select>
            )}
            {full && <p className="w-full text-[12.5px] text-dim">Tối đa {MAX_CRITERIA} tiêu chí.</p>}
            <p className="w-full text-[12.5px] text-dim">
              Tiêu chí tự chấm <b>không được tính tự động</b>: người dùng cho mỗi đối tác 0–100, ở trang Đối tác › “Chấm điểm” hoặc
              nhờ trợ lý (“chấm Phương Nam chất lượng hàng 80”). Đối tác chưa được chấm thì tiêu chí này được bỏ qua, các tiêu chí
              còn lại tự chia lại trọng số.
            </p>
          </div>
        )}
      </Panel>

      <Panel className="mb-4 p-5 text-[13.5px]">
        <h2 className="mb-1.5 text-[15px] font-semibold">Điểm được tính lúc nào?</h2>
        <p className="text-ink-2">Điểm không lưu sẵn: mỗi lần mở danh sách đối tác hay xem điểm, hệ thống tính lại ngay theo cách tính đang lưu.</p>
        <p className="text-ink-2">Dữ liệu lấy từ những gì ứng dụng tự ghi khi bạn thao tác: ghi Đã thu / Đã trả (đúng hạn hay trễ), Khách hẹn lại, Đã nhắc, gia hạn hoặc mất khách chữ ký số, ghi khiếu nại / giao hàng / lịch hẹn; từ hợp đồng (thâm niên, giá đang áp dụng) và từ điểm tự chấm.</p>
        <p className="text-ink-2">Ghi ở đâu: nút <b>“+ Ghi việc”</b> của từng đối tác (trang <Link to="/partners" className="text-act underline underline-offset-2">Đối tác</Link>) hoặc cuối trang một hợp đồng, hoặc nói với trợ lý (vd “Bếp Việt đã trả đợt 1 hôm qua”). Ghi nhầm thì bấm “Huỷ” ở dòng đó.</p>
        <p className="text-ink-2">Bấm “Lưu & tính lại điểm” còn lưu một ảnh chụp điểm của mọi đối tác để xem lịch sử thay đổi.</p>
      </Panel>

      <Panel className="mb-4 p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Quy tắc chung</h2>
        <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
          <div className="space-y-2 text-sm">
            <p className="text-dim">Xếp mức</p>
            <label className="flex items-center gap-3"><b className="w-12 text-ok">Tốt</b> từ
              <input className={numField} disabled={!owner} value={d.rules.good_from} onChange={(e) => setR({ good_from: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
            <label className="flex items-center gap-3"><b className="w-12">Khá</b> từ
              <input className={numField} disabled={!owner} value={d.rules.fair_from} onChange={(e) => setR({ fair_from: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
            <p className="flex items-center gap-3"><b className="w-12 text-soon">Chú ý</b> dưới {d.rules.fair_from}</p>
          </div>
          <div className="space-y-2 text-sm">
            <label className="block"><span className="text-dim">Chỉ chấm khi có tối thiểu</span>
              <span className="mt-1 flex items-center gap-2"><input className={numField} disabled={!owner} value={d.rules.min_events}
                onChange={(e) => setR({ min_events: Number(e.target.value.replace(/\D/g, "")) || 0 })} /> sự kiện</span></label>
            <label className="block"><span className="text-dim">Tính trong</span>
              <span className="mt-1 flex items-center gap-2"><input className={numField} disabled={!owner} value={d.rules.window_months}
                onChange={(e) => setR({ window_months: Number(e.target.value) || 1 })} /> tháng gần nhất</span></label>
          </div>
          <div className="space-y-3 text-sm">
            <label className="flex gap-3"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--color-act)]" disabled={!owner}
              checked={d.rules.recency_boost} onChange={(e) => setR({ recency_boost: e.target.checked })} />
              <span><b>Ưu tiên gần đây</b><span className="block text-dim">{d.rules.recency_months} tháng gần nhất tính gấp đôi</span></span></label>
            <label className="flex gap-3"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--color-act)]" disabled={!owner}
              checked={d.rules.manual_adjust} onChange={(e) => setR({ manual_adjust: e.target.checked })} />
              <span><b>Cho chỉnh tay ±10 điểm</b><span className="block text-dim">Bắt buộc ghi lý do</span></span></label>
          </div>
        </div>
      </Panel>

      {preview && (
        <Panel className="mb-4 p-5">
          <h2 className="mb-2 text-[15px] font-semibold">Xem trước nếu lưu cách tính này</h2>
          <ul className="space-y-1.5 text-sm">
            {preview.changes.slice(0, 8).map((x) => (
              <li key={x.company_id} className="flex justify-between gap-4 rounded-lg bg-sunk px-3 py-2">
                <span>{x.name}</span>
                <span className="font-mono">{x.old ?? "–"} → {x.new ?? "–"}{x.band_old !== x.band_new && x.band_new ? ` · ${(RANK[x.band_new] ?? 0) > (RANK[x.band_old ?? ""] ?? 0) ? "lên" : "xuống"} ${x.band_new === "good" ? "Tốt" : x.band_new === "fair" ? "Khá" : "Chú ý"}` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-dim">{preview.changed_band} / {preview.total} đối tác đổi mức.</p>
        </Panel>
      )}

      <Panel className="p-5">
        <h2 className="mb-2 text-[15px] font-semibold">Lịch sử thay đổi</h2>
        {!hist.data?.length ? <p className="text-sm text-dim">Chưa có thay đổi nào.</p> : (
          <ul className="space-y-1 text-[13.5px]">
            {hist.data.map((h) => <li key={h.version}><span className="font-mono text-dim">{viDate(h.at)}</span> · {h.by} · {h.summary}</li>)}
          </ul>
        )}
      </Panel>
    </>
  );
}
