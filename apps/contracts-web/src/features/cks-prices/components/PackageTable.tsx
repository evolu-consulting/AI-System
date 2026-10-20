// HD-FR-96 · S08 · bảng "Chữ ký số của tôi" — port `CksPricesTab.tsx:131-184` (ô theo cột đang hiện, cờ rẻ nhất / trên thị trường,
// thanh biên lãi, khoảng giá đại lý khác). "Dò giá" đã gỡ ở V2-J2.
import type { CksPackageRow } from "@ai/contracts";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import type { Column } from "~/features/table";
import { rowTone } from "../lib/prices";

const th =
  "px-4 py-3 text-left text-xs font-semibold text-dim whitespace-nowrap sticky top-0 z-10 bg-sunk";
const num = "px-4 py-3.5 text-right font-mono text-[13.5px] tnum whitespace-nowrap";
export const RIGHT = ["buy", "sell", "margin", "market", "sold"];

function MarketCell({ r }: { r: CksPackageRow }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.prices.${k}`);
  return (
    <td
      className={`${num} text-dim`}
      title={r.market?.sources.map((x) => `${x.seller}: ${vnd(x.price)}`).join("\n")}
    >
      {r.market
        ? r.market.min === r.market.max
          ? vnd(r.market.min)
          : `${vnd(r.market.min)}–${vnd(r.market.max)}`
        : "—"}
      {r.market?.any_device && (
        <span className="block font-sans text-[11px]">{L("anyDevice")}</span>
      )}
    </td>
  );
}
function PctCell({ pct }: { pct: number | null | undefined }) {
  return (
    <td className="px-4 py-3.5">
      {pct != null && (
        <span className="flex items-center gap-2 font-mono text-[13px]">
          {pct}%
          <span className="h-1.5 w-12 rounded-full bg-idle-bg">
            <span
              className="block h-1.5 rounded-full bg-act"
              style={{ width: `${Math.min(100, pct * 2)}%` }}
            />
          </span>
        </span>
      )}
    </td>
  );
}

function cells(
  r: CksPackageRow,
  market: ReactNode,
  L: (k: string) => string,
): Record<string, ReactNode> {
  const cheap = r.flags.includes("cheapest_buy");
  const above = r.flags.includes("above_market");
  return {
    pkg: (
      <td className="px-4 py-3">
        <span className="block text-[14px] font-semibold">{r.label}</span>
        <span className="block text-[12.5px] text-dim">
          {r.device_label}
          {cheap && <b className="font-semibold text-act">{L("cheapest")}</b>}
        </span>
        {above && <span className="block text-[12.5px] font-semibold text-soon">{L("above")}</span>}
      </td>
    ),
    buy: (
      <td
        className={`${num} ${cheap ? "font-semibold text-act underline decoration-1 underline-offset-4" : ""}`}
      >
        {vnd(r.buy)}
      </td>
    ),
    sell: (
      <td
        className={`${num} ${above ? "font-semibold text-soon underline decoration-1 underline-offset-4" : ""}`}
      >
        {vnd(r.sell)}
      </td>
    ),
    margin: <td className={num}>{vnd(r.margin)}</td>,
    pct: <PctCell pct={r.margin_pct} />,

    market,
    sold: <td className={num}>{r.sold}</td>,
  };
}

type Props = {
  rows: CksPackageRow[];
  shown: Column[];
};

export function PackageTable({ rows, shown }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cks.prices.${k}`);
  return (
    <table className="w-full" style={{ minWidth: Math.max(480, shown.length * 117) }}>
      <thead className="bg-sunk">
        <tr>
          {shown.map((c) => (
            <th key={c.key} className={`${th} ${RIGHT.includes(c.key) ? "text-right" : ""}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cell = cells(r, <MarketCell r={r} />, L);
          return (
            <tr key={r.label + r.device} className={`border-t border-rule-soft ${rowTone(r)}`}>
              {shown.map((c) => (
                <Fragment key={c.key}>{cell[c.key]}</Fragment>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
