import { dayPlus } from "@/api/followups";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errText } from "@/api/client";
import {
  postponeInstalment, recordEvent, remindInstalment, settleInstalment, useInstalments, usePartnerEvents, voidEvent,
  type Instalment, type PartnerEvent, type Role,
} from "@/api/partners";
import { canWrite, useMe } from "@/api/session";
import { ErrorLine, Loading, vnd, viDate } from "@/components/ui";
import { confirmDialog } from "@/components/dialog";
import { toast } from "@/components/toast";

const today = () => dayPlus(0);          // the local day (Vietnam)

/** How each recorded thing reads in the history; ratings and CKS renewals are recorded elsewhere. */
const WORD: Record<string, string> = {
  received: "Khách đã trả", paid: "Mình đã trả", delivered: "Giao hàng", postponed: "Hẹn lại", reminded: "Đã nhắc",
  complaint: "Khiếu nại", appointment_kept: "Giữ đúng hẹn", appointment_missed: "Lỡ hẹn", cks_renewed: "Gia hạn chữ ký số",
  cks_lapsed: "Mất khách chữ ký số", manual_adjust: "Chỉnh tay điểm", rating: "Chấm điểm",
};

/** Other things that happen with a partner, besides an instalment: what each one means to its reputation. */
const OTHER: { type: string; label: string; roles: Role[]; late?: boolean }[] = [
  { type: "delivered", label: "Giao hàng", roles: ["supplier"], late: true },
  { type: "complaint", label: "Khiếu nại / tranh chấp", roles: ["customer", "supplier"] },
  { type: "appointment_kept", label: "Giữ đúng hẹn", roles: ["customer", "supplier"] },
  { type: "appointment_missed", label: "Lỡ hẹn / huỷ hẹn", roles: ["customer", "supplier"] },
];

function said(e: PartnerEvent, answered = false): string {
  if (e.type === "overdue") {
    const who = e.party_late === false ? "Mình chưa trả" : e.kind === "delivery" ? "Chưa giao" : "Khách chưa trả";
    return [`Quá hạn · ${who}${e.seq ? ` đợt ${e.seq}` : ""}`, e.amount ? `${vnd(e.amount)} đ` : "",
      e.due_date ? `hạn ${viDate(e.due_date)}` : "", answered ? "sau đó đã xử lý" : ""].filter(Boolean).join(" · ");
  }
  const late = e.days_late ? `trễ ${e.days_late} ngày` : e.days_late === 0 ? "đúng hạn" : "";
  return [WORD[e.type] ?? e.type, e.type === "postponed" && e.to ? `sang ${viDate(e.to)}` : "",
    ["received", "paid", "delivered"].includes(e.type) ? late : "", e.amount ? `${vnd(e.amount)} đ` : "",
    e.type === "rating" && e.value != null ? `${e.value}/100` : ""].filter(Boolean).join(" · ");
}

/** "+ Ghi việc": mark an instalment paid / reminded / postponed (even before it is due), record a delivery, a
 *  complaint or an appointment, and undo a slip. Everything here feeds the partner's reputation. On a contract page
 *  (`contractId`) only that contract's instalments are listed. */
export default function PartnerLog({ companyId, role, contractId, onChange }: {
  companyId: string; role: Role; contractId?: string; onChange?: () => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const write = canWrite(me);
  const obs = useInstalments(companyId, contractId);
  const evs = usePartnerEvents(companyId);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** true when it was saved: a form clears or closes only then, a failed save keeps what was typed */
  async function act(key: string, f: () => Promise<unknown>, okMsg?: string): Promise<boolean> {
    setErr(null);
    setBusy(key);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: ["partners"] });
      onChange?.();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) { setErr(errText(e)); return false; } finally { setBusy(null); }
  }

  const all = evs.data ?? [];
  // a "Quá hạn" line is answered once its instalment was paid / delivered or moved to a later date
  const answered = new Set(all.filter((e) => !e.voided && ["received", "paid", "delivered", "postponed"].includes(e.type))
    .map((e) => e.obligation_id));
  const recent = all.filter((e) => !contractId || e.contract_id === contractId || !e.contract_id)
    .slice().reverse().slice(0, 15);
  return (
    <section className="space-y-3 text-sm" aria-label="Ghi việc với đối tác">
      <div>
        <h3 className="mb-1.5 text-[14px] font-semibold">Các đợt thanh toán chưa xong</h3>
        {obs.isLoading ? <Loading /> : obs.error ? <ErrorLine error={obs.error} /> : !obs.data?.length ? (
          <p className="text-[13px] text-dim">Không có đợt nào đang mở. App lập các đợt từ điều khoản thanh toán của hợp đồng đã xác nhận.</p>
        ) : (
          <ul className="space-y-1.5">
            {obs.data.map((o) => <InstalmentRow key={o.id} o={o} write={write} busy={busy} act={act} showContract={!contractId} />)}
          </ul>
        )}
      </div>

      {write && <OtherForm companyId={companyId} role={role} contractId={contractId} busy={busy} act={act} />}
      {err && <p role="alert" className="text-[12.5px] text-late">{err}</p>}

      <div>
        <h3 className="mb-1.5 text-[14px] font-semibold">Đã ghi gần đây</h3>
        {evs.isLoading ? <Loading /> : !recent.length ? <p className="text-[13px] text-dim">Chưa ghi việc gì.</p> : (
          <ul className="divide-y divide-rule-soft rounded-lg border border-rule-soft">
            {recent.map((e) => (
              <li key={e.id} className={`flex items-baseline gap-3 px-3 py-2 ${e.voided ? "text-dim line-through" : ""}`}>
                <span className="w-[82px] shrink-0 font-mono text-[12.5px] text-dim">{viDate(e.at)}</span>
                <span className={`min-w-0 flex-1 ${e.type === "overdue" && !answered.has(e.obligation_id) && e.party_late !== false ? "text-late" : ""}`}>
                  {said(e, e.type === "overdue" && answered.has(e.obligation_id))}{e.note && <span className="text-dim"> · {e.note}</span>}
                  <span className="block text-[12px] text-dim no-underline">
                    {e.source === "system" ? "Hệ thống tự ghi" : e.source === "assistant" ? `Qua trợ lý · ${e.by}` : e.by}
                    {e.voided ? " · đã huỷ" : ""}
                  </span>
                </span>
                {write && !e.voided && e.source !== "system" && e.type !== "rating" && !e.type.startsWith("cks_") && (
                  <button type="button" className="shrink-0 text-[12.5px] text-late hover:underline" disabled={!!busy}
                    onClick={async () => { if (await confirmDialog({ title: "Huỷ ghi việc này?",
                      body: <>“{said(e)}” ngày {viDate(e.at)}. Điểm uy tín sẽ được tính lại.</>,
                      confirmLabel: "Huỷ việc này", danger: true })) void act(`void:${e.id}`, () => voidEvent(e.id), "Đã huỷ"); }}>
                    Huỷ
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type Act = (key: string, f: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;

function InstalmentRow({ o, write, busy, act, showContract }: { o: Instalment; write: boolean; busy: string | null; act: Act; showContract: boolean }) {
  const [mode, setMode] = useState<"pay" | "later" | null>(null);
  const [at, setAt] = useState(today());
  const [to, setTo] = useState("");
  const receive = o.direction === "receive";
  const late = o.due_date < today();
  return (
    <li className="rounded-lg bg-sunk px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>{receive ? "Khách trả" : "Mình trả"} đợt {o.seq}</b>
        <span className="font-mono">{o.amount != null ? `${vnd(o.amount)} đ` : "—"}</span>
        <span className={late ? "text-late" : "text-dim"} title={o.basis}>
          hạn {viDate(o.due_date)}{o.estimated ? " (ước tính)" : ""}{late ? " · quá hạn" : ""}
        </span>
        {showContract && o.contract_number && <span className="text-[12.5px] text-dim">HĐ {o.contract_number}</span>}
        {!!o.reminders && <span className="text-[12.5px] text-dim">đã nhắc {o.reminders} lần</span>}
        {write && (
          <span className="ml-auto flex gap-1.5">
            <button type="button" className="btn btn-primary h-8 text-[13px]" onClick={() => setMode(mode === "pay" ? null : "pay")}>
              {receive ? "Đã thu" : "Đã trả"}
            </button>
            {receive && <button type="button" className="btn btn-quiet h-8 text-[13px]" disabled={!!busy}
              onClick={() => act(`remind:${o.id}`, () => remindInstalment(o.id), "Đã ghi lượt nhắc")}>{busy === `remind:${o.id}` ? "…" : "Đã nhắc"}</button>}
            {receive && <button type="button" className="btn btn-quiet h-8 text-[13px]" onClick={() => setMode(mode === "later" ? null : "later")}>Khách hẹn lại</button>}
          </span>
        )}
      </div>
      {mode === "pay" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span>{receive ? "Khách trả" : "Mình trả"} ngày</span>
          <input type="date" className="field h-8 w-[150px]" value={at} max={today()} onChange={(e) => setAt(e.target.value)} aria-label="Ngày trả" />
          <span className="text-dim">{at > o.due_date ? `trễ ${Math.round((Date.parse(at) - Date.parse(o.due_date)) / 864e5)} ngày` : "đúng hạn"}</span>
          <button type="button" className="btn btn-primary h-8" disabled={!!busy || !at}
            onClick={() => act(`pay:${o.id}`, () => settleInstalment(o.id, at), receive ? "Đã ghi khách trả" : "Đã ghi mình trả").then((ok) => ok && setMode(null))}>
            {busy === `pay:${o.id}` ? "Đang ghi…" : "Ghi"}
          </button>
        </div>
      )}
      {mode === "later" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span>Khách hẹn trả ngày</span>
          <input type="date" className="field h-8 w-[150px]" value={to} min={o.due_date} onChange={(e) => setTo(e.target.value)} aria-label="Ngày hẹn mới" />
          <button type="button" className="btn btn-primary h-8" disabled={!!busy || !to || to <= o.due_date}
            onClick={() => act(`later:${o.id}`, () => postponeInstalment(o.id, to), "Đã ghi hẹn lại").then((ok) => ok && setMode(null))}>
            {busy === `later:${o.id}` ? "Đang ghi…" : "Ghi"}
          </button>
        </div>
      )}
    </li>
  );
}

function OtherForm({ companyId, role, contractId, busy, act }: { companyId: string; role: Role; contractId?: string; busy: string | null; act: Act }) {
  const kinds = OTHER.filter((k) => k.roles.includes(role));
  const [type, setType] = useState(kinds[0].type);
  const [at, setAt] = useState(today());
  const [late, setLate] = useState(0);
  const [note, setNote] = useState("");
  const kind = OTHER.find((k) => k.type === type)!;
  return (
    <div>
      <h3 className="mb-1.5 text-[14px] font-semibold">Ghi việc khác</h3>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <select className="field h-8 w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại việc">
          {kinds.map((k) => <option key={k.type} value={k.type}>{k.label}</option>)}
        </select>
        <input type="date" className="field h-8 w-[150px]" value={at} max={today()} onChange={(e) => setAt(e.target.value)} aria-label="Ngày" />
        {kind.late && (
          <label className="flex items-center gap-1.5">trễ
            <input className="field h-8 w-[56px] text-right font-mono" inputMode="numeric" value={late}
              onChange={(e) => setLate(Number(e.target.value.replace(/\D/g, "")) || 0)} aria-label="Số ngày trễ" /> ngày
          </label>
        )}
        <input className="field h-8 min-w-[180px] flex-1" placeholder={type === "complaint" ? "Nội dung khiếu nại" : "Ghi chú (không bắt buộc)"}
          value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Ghi chú" />
        <button type="button" className="btn btn-primary h-8" disabled={!!busy || (type === "complaint" && !note.trim())}
          onClick={() => act("other", () => recordEvent({ company_id: companyId, role, type, at, note: note.trim() || undefined,
            days_late: kind.late ? late : undefined, contract_id: contractId }), "Đã ghi việc").then((ok) => { if (ok) { setNote(""); setLate(0); } })}>
          {busy === "other" ? "Đang ghi…" : "Ghi"}
        </button>
      </div>
    </div>
  );
}
