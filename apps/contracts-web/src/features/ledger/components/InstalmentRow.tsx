// HD7-FR-04…06 · HD7-FR-12 · một đợt chưa xong — port `PartnerLog.tsx:125-175`: Đã thu/Đã trả (ngày trả, trễ N ngày), Đã nhắc,
// Khách hẹn lại (ngày hẹn > hạn). Hạn đã qua tô đỏ.
import type { Obligation } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { useLedgerWrites } from "../hooks/use-ledger";
import { lateBy, today } from "../lib/ledger";
import type { Act } from "../lib/use-act";

type Props = {
  o: Obligation;
  write: boolean;
  busy: string | null;
  act: Act;
  showContract: boolean;
};
type FormProps = { o: Obligation; busy: string | null; act: Act; done: () => void };
type T = (k: string, x?: Record<string, unknown>) => string;

function PayForm({ o, busy, act, done }: FormProps) {
  const { t } = useTranslation();
  const { settleInstalment } = useLedgerWrites();
  const L: T = (k, x) => t(`contracts.ledger.${k}`, x);
  const [at, setAt] = useState(today());
  const receive = o.direction === "receive";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span>{L("payOn", { who: receive ? L("customerPays") : L("wePay") })}</span>
      <input
        type="date"
        className="field h-8 w-[150px]"
        value={at}
        max={today()}
        onChange={(e) => setAt(e.target.value)}
        aria-label={L("payDate")}
      />
      <span className="text-dim">
        {at > o.due_date ? L("lateDays", { n: lateBy(at, o.due_date) }) : L("onTime")}
      </span>
      <button
        type="button"
        className="btn btn-primary h-8"
        disabled={!!busy || !at}
        onClick={() =>
          act(
            `pay:${o.id}`,
            () => settleInstalment(o.id, at),
            receive ? L("toast.received") : L("toast.paid"),
          ).then((ok) => ok && done())
        }
      >
        {busy === `pay:${o.id}` ? L("saving") : L("save")}
      </button>
    </div>
  );
}

function LaterForm({ o, busy, act, done }: FormProps) {
  const { t } = useTranslation();
  const { postponeInstalment } = useLedgerWrites();
  const L: T = (k, x) => t(`contracts.ledger.${k}`, x);
  const [to, setTo] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span>{L("laterOn")}</span>
      <input
        type="date"
        className="field h-8 w-[150px]"
        value={to}
        min={o.due_date}
        onChange={(e) => setTo(e.target.value)}
        aria-label={L("laterDate")}
      />
      <button
        type="button"
        className="btn btn-primary h-8"
        disabled={!!busy || !to || to <= o.due_date}
        onClick={() =>
          act(`later:${o.id}`, () => postponeInstalment(o.id, to), L("toast.later")).then(
            (ok) => ok && done(),
          )
        }
      >
        {busy === `later:${o.id}` ? L("saving") : L("save")}
      </button>
    </div>
  );
}

function Buttons({
  o,
  busy,
  act,
  mode,
  setMode,
  L,
}: {
  o: Obligation;
  busy: string | null;
  act: Act;
  mode: string | null;
  setMode: (m: "pay" | "later" | null) => void;
  L: T;
}) {
  const { remindInstalment } = useLedgerWrites();
  const receive = o.direction === "receive";
  return (
    <span className="ml-auto flex gap-1.5">
      <button
        type="button"
        className="btn btn-primary h-8 text-[13px]"
        onClick={() => setMode(mode === "pay" ? null : "pay")}
      >
        {receive ? L("received") : L("paid")}
      </button>
      {receive && (
        <button
          type="button"
          className="btn btn-quiet h-8 text-[13px]"
          disabled={!!busy}
          onClick={() => act(`remind:${o.id}`, () => remindInstalment(o.id), L("toast.reminded"))}
        >
          {busy === `remind:${o.id}` ? "…" : L("remind")}
        </button>
      )}
      {receive && (
        <button
          type="button"
          className="btn btn-quiet h-8 text-[13px]"
          onClick={() => setMode(mode === "later" ? null : "later")}
        >
          {L("later")}
        </button>
      )}
    </span>
  );
}

export function InstalmentRow({ o, write, busy, act, showContract }: Props) {
  const { t } = useTranslation();
  const L: T = (k, x) => t(`contracts.ledger.${k}`, x);
  const [mode, setMode] = useState<"pay" | "later" | null>(null);
  const late = o.due_date < today();
  const who = o.direction === "receive" ? L("customerPays") : L("wePay");
  const done = () => setMode(null);
  return (
    <li className="rounded-lg bg-sunk px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>{L("instalment", { who, seq: o.seq })}</b>
        <span className="font-mono">
          {o.amount != null ? L("money", { v: vnd(o.amount) }) : "—"}
        </span>
        <span className={late ? "text-late" : "text-dim"} title={o.basis ?? undefined}>
          {L("due", { date: viDate(o.due_date) })}
          {o.estimated ? L("estimated") : ""}
          {late ? L("lateMark") : ""}
        </span>
        {showContract && o.contract_number && (
          <span className="text-[12.5px] text-dim">
            {L("contractNo", { n: o.contract_number })}
          </span>
        )}
        {!!o.reminders && (
          <span className="text-[12.5px] text-dim">{L("reminded", { n: o.reminders })}</span>
        )}
        {write && <Buttons o={o} busy={busy} act={act} mode={mode} setMode={setMode} L={L} />}
      </div>
      {mode === "pay" && <PayForm o={o} busy={busy} act={act} done={done} />}
      {mode === "later" && <LaterForm o={o} busy={busy} act={act} done={done} />}
    </li>
  );
}
