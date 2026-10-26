// CR-097 G2 · GD-FR-03: khối chi tiết giao dịch — bảng dòng (bản hiện hành), nghĩa vụ thanh toán (chỉ xem), dòng thời gian `events`,
// mô tả (ghi chú / người giữ / nhãn lô, sửa trực tiếp sau ghi sổ).
import type { TransactionDetail } from "@ai/contracts";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { eventDetail, eventKey } from "../lib/transactions";

const Block = ({
  title,
  testid,
  children,
}: {
  title: string;
  testid: string;
  children: ReactNode;
}) => (
  <section data-testid={testid} className="rounded-lg border border-rule bg-panel p-4">
    <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
    {children}
  </section>
);

export function LinesTable({ tx }: { tx: TransactionDetail }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.txn.${k}`);
  return (
    <Block title={L("form.lines")} testid="tx-lines-view">
      <div className="overflow-auto">
        <table className="w-full text-[13.5px]">
          <thead className="text-left text-[12px] text-dim">
            <tr>
              <th className="py-1 font-semibold">{L("line.name")}</th>
              <th className="py-1 text-right font-semibold">{L("line.qty")}</th>
              <th className="py-1 text-right font-semibold">{L("line.price")}</th>
              <th className="py-1 text-right font-semibold">{L("line.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {tx.lines.map((l) => (
              <tr key={l.id} className="border-t border-rule-soft">
                <td className="py-1.5">
                  {l.name}
                  {!l.product_id && (
                    <span className="ml-2 text-[12px] text-dim">{L("line.noProduct")}</span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {l.qty} {l.unit ?? ""}
                </td>
                <td className="py-1.5 text-right tabular-nums">{vnd(l.unit_price)}</td>
                <td className="py-1.5 text-right tabular-nums">{vnd(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-right font-semibold" data-testid="tx-total">
        {L("form.total")}: {vnd(tx.total)} ₫
      </p>
    </Block>
  );
}

export function ObligationsBlock({ tx }: { tx: TransactionDetail }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.txn.${k}`);
  if (tx.status === "draft") return null;
  return (
    <Block title={L("obligations.title")} testid="tx-obligations">
      {tx.obligations.length === 0 ? (
        <p className="text-sm text-dim">{L("obligations.none")}</p>
      ) : (
        <ul className="divide-y divide-rule-soft">
          {tx.obligations.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-[13.5px]">
              <Tag tone={o.direction === "receive" ? "ok" : "act"}>
                {L(`obligations.${o.direction}`)}
              </Tag>
              <span>
                {L("obligations.seq")} {o.seq}
              </span>
              <span className="text-dim">{viDate(o.due_date)}</span>
              <span className="ml-auto tabular-nums">{vnd(o.amount)} ₫</span>
              <Tag
                tone={o.status === "cancelled" ? "grey" : "soon"}
                title={o.cancel_reason ?? undefined}
              >
                {o.status}
              </Tag>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-dim">{L("obligations.readonly")}</p>
    </Block>
  );
}

export function EventsBlock({ tx }: { tx: TransactionDetail }) {
  const { t } = useTranslation();
  return (
    <Block title={t("contracts.txn.events")} testid="tx-events">
      <ol className="flex flex-col gap-2">
        {tx.events.map((e) => {
          const extra = eventDetail(e.data, t);
          return (
            <li
              key={e.id}
              data-testid="tx-event"
              className="flex flex-wrap items-baseline gap-x-3 text-[13.5px]"
            >
              <Tag tone={e.type === "cancelled" ? "late" : e.type === "posted" ? "ok" : "act"}>
                {t(eventKey(e.type))}
              </Tag>
              <span className="text-dim">{viDate(e.at)}</span>
              {extra && <span className="text-dim">{extra}</span>}
              {e.reason && <span className="basis-full pl-1 text-ink-2">“{e.reason}”</span>}
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

/** Mô tả sau ghi sổ: sửa trực tiếp, máy chủ ghi vết `described`. */
export function DescribeBlock({
  tx,
  canEdit,
  busy,
  error,
  onSave,
}: {
  tx: TransactionDetail;
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  onSave: (v: { note: string; holder: string; lot_label: string }) => void;
}) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.txn.${k}`);
  const [v, setV] = useState({
    note: tx.note ?? "",
    holder: tx.holder ?? "",
    lot_label: tx.lot_label ?? "",
  });
  const dirty =
    v.note !== (tx.note ?? "") ||
    v.holder !== (tx.holder ?? "") ||
    v.lot_label !== (tx.lot_label ?? "");
  const field = (k: keyof typeof v, label: string, area = false) => (
    <div className="flex flex-col gap-1 text-[13px]">
      <label htmlFor={`tx-desc-${k}`}>{label}</label>
      {area ? (
        <textarea
          id={`tx-desc-${k}`}
          rows={2}
          maxLength={2000}
          value={v[k]}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, [k]: e.target.value })}
          className="field"
        />
      ) : (
        <input
          id={`tx-desc-${k}`}
          maxLength={200}
          value={v[k]}
          disabled={!canEdit}
          onChange={(e) => setV({ ...v, [k]: e.target.value })}
          className="field h-[2.4rem]"
        />
      )}
    </div>
  );
  return (
    <Block title={L("describe.title")} testid="tx-describe">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("holder", L("describe.holder"))}
        {field("lot_label", L("describe.lot"))}
        <div className="sm:col-span-2">{field("note", L("form.note"), true)}</div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-late">
          {error}
        </p>
      )}
      {canEdit && (
        <button
          type="button"
          className="btn btn-primary btn-sm mt-3"
          disabled={!dirty || busy}
          data-testid="tx-describe-save"
          onClick={() => onSave(v)}
        >
          {L("describe.save")}
        </button>
      )}
    </Block>
  );
}
