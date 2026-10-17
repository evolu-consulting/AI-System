import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, errText, send } from "@/api/client";
import { applyTableFilter, type TableFilterCard } from "@/components/table";
import { confirmDialog } from "@/components/dialog";
import { runPrefill, type UiCard } from "./prefill";

/** A server-built action card (PLAN §2.3): the UI only calls the path written in it, never invents one. */
export type CardAction = { label: string; method?: "POST" | "PUT" | "DELETE"; path?: string; body?: Record<string, unknown>;
  href?: string; primary?: boolean;
  /** "Khách hẹn lại": the person picks the new date (body.to is only the suggestion) and when to be reminded. */
  ask_date?: boolean;
  /** "Nhắc lại sau": the person picks a date and time (body.at is the suggestion). */
  ask_datetime?: boolean };
export type Card = { id?: string; type: string; tone?: "late" | "soon" | "ok" | "info"; lead?: string; title: string;
  body?: string; amount?: string; actions?: CardAction[]; fields?: [string, string][];
  /** type "ui": a form the assistant opened and filled (assistant/prefill.ts) */
  form?: string; path?: string; open?: string | null; submit?: string; values?: Record<string, unknown> };

const LEAD_TONE = { late: "text-late", soon: "text-soon", ok: "text-ok", info: "text-act" } as const;

/** "Đã mở form … và điền sẵn": the person checks it on the page; "Mở lại form" fills it again if they closed it. */
function FormCard({ card }: { card: Card }) {
  const nav = useNavigate();
  return (
    <div className="rounded-xl border border-act-line bg-act-soft p-3.5 text-[13.5px] leading-snug text-act">
      <p><b className="font-semibold">✦ Đã mở «{card.title}»</b> và điền sẵn. Kiểm tra trên trang rồi bấm «{card.submit}».</p>
      <button type="button" className="btn btn-sm btn-outline mt-2" onClick={() => void runPrefill(card as UiCard, nav)}>Mở lại form</button>
    </div>
  );
}

/** "Đã lọc bảng …": what the assistant filtered on; the chips on the page can be changed or removed by hand. */
function FilterCard({ card }: { card: Card }) {
  const nav = useNavigate();
  const f = card as unknown as TableFilterCard & { summary?: string[] };
  return (
    <div className="rounded-xl border border-act-line bg-act-soft p-3.5 text-[13.5px] leading-snug text-act">
      <p><b className="font-semibold">✦ Đã lọc bảng «{f.title}»</b>{f.summary?.length ? `: ${f.summary.join(" · ")}` : ""}.</p>
      <button type="button" className="btn btn-sm btn-outline mt-2" onClick={() => applyTableFilter(f, nav)}>Áp lại bộ lọc</button>
    </div>
  );
}

export function ActionCard({ card, onDone }: { card: Card; onDone?: () => void }) {
  if (card.type === "ui") return <FormCard card={card} />;
  if (card.type === "filter") return <FilterCard card={card} />;
  return <Actionable card={card} onDone={onDone} />;
}

function Actionable({ card, onDone }: { card: Card; onDone?: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ a: CardAction; date: string; time: string } | null>(null);
  // a card whose action went through says so and offers it no more: pressing "Nhập 2 chữ ký" twice reads as a fault
  const [done, setDone] = useState<string | null>(null);

  async function run(a: CardAction, override?: Record<string, unknown>) {
    if (a.href) return nav(a.href);
    if (!a.path) return;
    if (a.ask_date && !override) return setAsking({ a, date: String(a.body?.to ?? ""), time: "09:00" });
    if (a.ask_datetime && !override) {
      const [d, t] = String(a.body?.at ?? "").split("T");
      return setAsking({ a, date: d, time: (t ?? "09:00").slice(0, 5) });
    }
    if (a.method === "DELETE") {
      const ok = await confirmDialog({ title: `${a.label}?`, body: card.title, confirmLabel: a.label, danger: true });
      if (!ok) return;
    }
    setBusy(a.label);
    setErr(null);
    try {
      await api(a.path, send({ ...(a.body ?? {}), ...override }, a.method ?? "POST"));
      setAsking(null);
      setDone(a.label);
      await qc.invalidateQueries();          // every page reads fresh: the row turns "Đã thanh toán", the score moves
      onDone?.();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl bg-panel p-3.5 text-[13.5px] leading-snug">
      <p>
        {card.lead && <b className={`font-semibold ${LEAD_TONE[card.tone ?? "info"]}`}>{card.lead}</b>}
        {card.lead && " · "}
        {card.title}
        {card.amount && <span className="mt-0.5 block font-mono text-[13px]">{card.amount}</span>}
      </p>
      {card.body && <p className="mt-1 text-dim">{card.body}</p>}
      {card.fields && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {card.fields.map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-dim">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
      )}
      {done && <p className="mt-2.5 text-[13px] font-medium text-ok">✓ Đã làm: {done}</p>}
      {!done && !!card.actions?.length && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {card.actions.map((a) => (
            <button key={a.label} type="button" disabled={!!busy} onClick={() => run(a)}
              className={`btn btn-sm ${a.primary ? "btn-primary" : "btn-outline"}`}>
              {busy === a.label ? "Đang làm…" : a.label}
            </button>
          ))}
        </div>
      )}
      {asking && (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          const at = asking.time ? `${asking.date}T${asking.time}` : undefined;
          run(asking.a, asking.a.ask_datetime ? { at } : { to: asking.date, remind_at: at });
        }}>
          <label className="flex flex-col text-[12px] text-dim">
            {asking.a.ask_datetime ? "Nhắc vào ngày" : "Ngày khách hẹn"}
            <input type="date" required value={asking.date} onChange={(e) => setAsking({ ...asking, date: e.target.value })}
              className="field btn-sm h-9 w-auto" />
          </label>
          <label className="flex flex-col text-[12px] text-dim">
            {asking.a.ask_datetime ? "Lúc" : "Nhắc tôi lúc"}
            <input type="time" required={!!asking.a.ask_datetime} value={asking.time}
              onChange={(e) => setAsking({ ...asking, time: e.target.value })} className="field btn-sm h-9 w-auto" />
          </label>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!!busy}>
            {asking.a.ask_datetime ? "Hẹn nhắc" : "Dời hẹn"}
          </button>
          <button type="button" className="text-[13px] text-dim" onClick={() => setAsking(null)}>Huỷ</button>
        </form>
      )}
      {err && <p role="alert" className="mt-2 text-[12.5px] text-late">{err}</p>}
    </div>
  );
}
