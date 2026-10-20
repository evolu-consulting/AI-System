// HD-FR-96 · S08 · định dạng và luật hiển thị của tab giá CKS — port `CksPricesTab.tsx:11-54`.
import type { CksPackageRow } from "@ai/contracts";

/** "12,5 tr" cho ô số liệu (`CksPricesTab.tsx:37`). */
export const tr = (n: number): string =>
  `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 1 })} tr`;

/** Nền hàng: bán cao hơn thị trường > giá mua thấp nhất. */
export function rowTone(r: CksPackageRow): string {
  if (r.flags.includes("above_market")) return "bg-soon-bg/60";
  if (r.flags.includes("cheapest_buy")) return "bg-ok-bg/60";
  return "";
}
