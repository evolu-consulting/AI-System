// V2-F · HD-04 · BA 5.7 · mockup `itemsView`: khối "Sản phẩm" của HĐ đã lưu — nhãn Nhập kho (Mua) / Xuất kho (Bán) / Không ảnh hưởng kho
// (Giới thiệu), bảng dòng + thành tiền + tổng. Dòng SP khoá sau khi lưu (C12): chỉ xem.
import type { ContractDeal, ContractItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { STOCK_EFFECT } from "~/features/contract-form/lib/deal";
import { stockTone } from "~/features/contract-form/lib/stock-label";

const lineSum = (it: ContractItem): number | null =>
  it.qty != null && it.unit_price != null ? Math.round(it.qty * it.unit_price) : null;

export function ProductsPanel({
  items,
  deal,
}: {
  items: readonly ContractItem[];
  deal: ContractDeal;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  if (items.length === 0) return null;
  const effect = STOCK_EFFECT[deal];
  const total = items.reduce((a, it) => a + (lineSum(it) ?? 0), 0);
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("products")}</h2>
        <Tag tone={stockTone(effect)}>{t(`contracts.cform.stock.${effect}`)}</Tag>
        <span className="text-[12.5px] text-dim">{L("lineCount", { n: items.length })}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-left text-xs text-dim">
            <tr>
              <th className="px-4 py-2.5 first:pl-5">{L("colLine")}</th>
              <th className="px-4 text-right">{L("colQty")}</th>
              <th className="px-4 text-right">{L("colPrice")}</th>
              <th className="px-4 text-right last:pr-5">{L("colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const s = lineSum(it);
              return (
                <tr key={it.id} className="border-t border-rule-soft">
                  <td className="px-4 py-2.5 first:pl-5">{it.name}</td>
                  <td className="px-4 text-right font-mono whitespace-nowrap">
                    {it.qty ?? ""} <span className="text-dim">{it.unit ?? ""}</span>
                  </td>
                  <td className="px-4 text-right font-mono">{vnd(it.unit_price)}</td>
                  <td className="px-4 text-right font-mono last:pr-5">
                    {s === null ? "—" : vnd(s)}
                  </td>
                </tr>
              );
            })}
            {total > 0 && (
              <tr className="border-t border-rule font-semibold">
                <td colSpan={3} className="px-4 py-2.5 pl-5">
                  {L("total")}
                </td>
                <td className="px-4 text-right font-mono pr-5" data-testid="products-total">
                  {vnd(total)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
