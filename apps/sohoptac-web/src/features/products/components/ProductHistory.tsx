// V2-J1 · SP-02: tab "Lịch sử mua bán" — Mua: lô (giá nhập, chênh so lần trước, còn lại); Bán: giá bán, giá vốn, lãi. Dữ liệu từ chi tiết SP.
import type { BizDetailOut } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Empty } from "~/components/shared/states";
import { qtyText } from "../lib/business";

const money = (n: number | null) => (n === null ? "—" : `${vnd(n)} đ`);
const th = "px-4 py-2.5 font-medium";
const td = "px-4 py-2.5";
/** Giá nhập tăng so lần trước ⇒ đỏ, giảm ⇒ xanh. */
const changeTone = (n: number | null) => (!n ? "text-dim" : n > 0 ? "text-late" : "text-ok");
const changeText = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${vnd(n)} đ`);

function Lots({ lots }: { lots: BizDetailOut["lots"] }) {
  const { t } = useTranslation();
  if (!lots.length) return <Empty title={t("contracts.catalog.hist.noLots")} />;
  return (
    <table className="w-full text-left text-[14px]">
      <thead className="border-b border-rule text-[12px] text-dim">
        <tr>
          {(["date", "supplier", "price", "change", "qty", "remaining", "expires"] as const).map(
            (c) => (
              <th key={c} className={th}>
                {t(`contracts.catalog.hist.lot.${c}`)}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {lots.map((l) => (
          <tr key={l.id} className="border-b border-rule-soft last:border-0">
            <td className={td}>{viDate(l.received_on)}</td>
            <td className={td}>{l.supplier ?? "—"}</td>
            <td className={`${td} tnum`}>{money(l.unit_cost)}</td>
            <td className={`${td} tnum ${changeTone(l.price_change)}`}>
              {changeText(l.price_change)}
            </td>
            <td className={`${td} tnum`}>{qtyText(l.qty)}</td>
            <td className={`${td} tnum`}>{qtyText(l.remaining)}</td>
            <td className={td}>{l.expires_on ? viDate(l.expires_on) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sales({ sales }: { sales: BizDetailOut["sales"] }) {
  const { t } = useTranslation();
  if (!sales.length) return <Empty title={t("contracts.catalog.hist.noSales")} />;
  return (
    <table className="w-full text-left text-[14px]">
      <thead className="border-b border-rule text-[12px] text-dim">
        <tr>
          {(["date", "contract", "customer", "qty", "price", "cost", "profit"] as const).map(
            (c) => (
              <th key={c} className={th}>
                {t(`contracts.catalog.hist.sale.${c}`)}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {sales.map((s) => (
          <tr
            key={`${s.contract_id}:${s.on}:${s.qty}`}
            className="border-b border-rule-soft last:border-0"
          >
            <td className={td}>{viDate(s.on)}</td>
            <td className={td}>
              <Link
                to="/contracts/$id"
                params={{ id: s.contract_id }}
                className="text-act hover:underline"
              >
                {s.contract_title}
              </Link>
            </td>
            <td className={td}>{s.customer ?? "—"}</td>
            <td className={`${td} tnum`}>{qtyText(s.qty)}</td>
            <td className={`${td} tnum`}>{money(s.unit_price)}</td>
            <td className={`${td} tnum`}>{money(s.cost)}</td>
            <td
              className={`${td} tnum ${s.profit === null ? "text-dim" : s.profit < 0 ? "text-late" : "text-ok"}`}
            >
              {money(s.profit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProductHistory({ d }: { d: BizDetailOut }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"buy" | "sell">("buy");
  return (
    <div>
      <div role="radiogroup" className="flex gap-1 border-b border-rule-soft px-4 py-2.5">
        {(["buy", "sell"] as const).map((k) => (
          // biome-ignore lint/a11y/useSemanticElements: nút dạng radio theo mockup NITI
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={view === k}
            onClick={() => setView(k)}
            className="rounded-md px-3 py-1 text-[13px] text-ink-2 aria-checked:bg-act-soft aria-checked:font-semibold aria-checked:text-act"
          >
            {t(`contracts.catalog.hist.${k}`)}
            {k === "sell" && d.sales.length > 0 ? ` · ${d.sales.length}` : ""}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        {view === "buy" ? <Lots lots={d.lots} /> : <Sales sales={d.sales} />}
      </div>
    </div>
  );
}
