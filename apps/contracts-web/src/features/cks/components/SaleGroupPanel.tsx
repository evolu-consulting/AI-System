// HD-FR-94 · S11 · một nhóm bán: tiêu đề HĐ, hạn cùng nhóm, "Gia hạn cả nhóm"/"Nhập serial mới", "🔔 Hẹn nhắc" + form hẹn, danh
// sách chữ ký chọn được — port `CksCustomerPage.tsx:78-145`.
import type { CksCustomer } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { daysUntil } from "../lib/cks";

export type Ask = {
  sale: string;
  mode: "renew" | "followup";
  date: string;
  time: string;
  note: string;
};
type Sale = CksCustomer["sales"][number];

function GroupExpiry({ validTo }: { validTo: string }) {
  const { t } = useTranslation();
  const left = daysUntil(validTo);
  return (
    <span
      className={`ml-auto text-[13px] font-semibold ${left < 0 ? "text-late" : left <= 30 ? "text-soon" : "text-dim"}`}
    >
      {left < 0
        ? t("contracts.cks.customer.groupExpired", { date: viDate(validTo) })
        : t("contracts.cks.customer.groupExpiry", { date: viDate(validTo), n: left })}
    </span>
  );
}

export function AskForm({
  ask,
  setAsk,
  submit,
  today,
}: {
  ask: Ask;
  setAsk: (a: Ask | null) => void;
  submit: (a: Ask) => void;
  today: string;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.customer.${k}`);
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-b border-rule px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit(ask);
      }}
    >
      <p className="w-full text-[13px] text-dim">
        {ask.mode === "renew" ? L("askRenew") : L("askFollow")}
      </p>
      <label className="flex flex-col text-[12px] text-dim">
        {L("date")}
        <input
          type="date"
          required
          value={ask.date}
          min={today}
          onChange={(e) => setAsk({ ...ask, date: e.target.value })}
          className="field btn-sm h-9 w-auto"
        />
      </label>
      <label className="flex flex-col text-[12px] text-dim">
        {L("time")}
        <input
          type="time"
          value={ask.time}
          required={ask.mode === "followup"}
          onChange={(e) => setAsk({ ...ask, time: e.target.value })}
          className="field btn-sm h-9 w-auto"
        />
      </label>
      {ask.mode === "followup" && (
        <label className="flex flex-col text-[12px] text-dim">
          {L("note")}
          <input
            value={ask.note}
            maxLength={200}
            placeholder={L("notePh")}
            onChange={(e) => setAsk({ ...ask, note: e.target.value })}
            className="field btn-sm h-9 w-56"
          />
        </label>
      )}
      <button type="submit" className="btn btn-sm btn-primary">
        {ask.mode === "renew" ? L("doRenew") : L("doRemind")}
      </button>
      <button type="button" className="h-9 text-[13px] text-dim" onClick={() => setAsk(null)}>
        {L("cancel")}
      </button>
    </form>
  );
}

type Props = {
  s: Sale;
  certs: CksCustomer["certs"];
  write: boolean;
  selected: string | undefined;
  select: (id: string) => void;
  onAsk: (mode: Ask["mode"]) => void;
  onComplete: () => void;
  children?: React.ReactNode;
};

export function SaleGroupPanel({
  s,
  certs,
  write,
  selected,
  select,
  onAsk,
  onComplete,
  children,
}: Props) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.customer.${k}`, o);
  return (
    <Panel className="mb-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-sunk px-5 py-4">
        <div className="min-w-0">
          <Link
            to="/contracts/$id"
            params={{ id: s.contract_id }}
            className="text-[17px] font-semibold underline underline-offset-4"
          >
            {L("saleTitle", { number: s.number })}
          </Link>
          <p className="text-[13px] text-dim">
            {L("saleSub", {
              date: viDate(s.signed_at),
              count: s.count,
              price: vnd(s.price_each),
              total: vnd(s.total),
            })}
            {s.paid ? L("paid") : ""}
          </p>
        </div>
        {s.valid_to && <GroupExpiry validTo={s.valid_to} />}
        {write &&
          (s.renewal?.status === "open" ? (
            <>
              <span className="tag">{L("renewing")}</span>
              <button type="button" className="btn btn-outline" onClick={onComplete}>
                {L("enterSerials")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => onAsk("renew")}>
              {L("renewGroup")}
            </button>
          ))}
        <button
          type="button"
          className="btn btn-quiet"
          title={L("remindTitle")}
          onClick={() => onAsk("followup")}
        >
          {L("remind")}
        </button>
      </div>
      {children}
      <ul>
        {certs
          .filter((x) => x.sale_contract_id === s.contract_id)
          .map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => select(x.id)}
                aria-pressed={selected === x.id}
                className={`grid w-full grid-cols-[minmax(0,1.4fr)_1fr_auto] items-center gap-4 border-b border-rule-soft px-5 py-3 text-left last:border-0 ${selected === x.id ? "bg-act-soft" : "hover:bg-sunk"}`}
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{x.label}</span>
                  <span className="block font-mono text-[12.5px] text-dim">
                    {x.ca} ·{" "}
                    {x.device === "token" ? t("contracts.cks.token") : t("contracts.cks.remote")} ·{" "}
                    {x.serial}
                  </span>
                </span>
                <span className="text-[13px] text-dim">
                  {x.device === "token" ? L("keeper", { name: x.keeper ?? "—" }) : L("phone")}
                </span>
                <span className="font-mono text-[13px] tnum">
                  {L("docs", { n: x.signed_count })}
                </span>
              </button>
            </li>
          ))}
      </ul>
    </Panel>
  );
}
