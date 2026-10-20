// V2-F · HD-04 · BA 5.7 · mockup `itemsView`: khối "Sản phẩm" của HĐ đã lưu — nhãn Nhập kho (Mua) / Xuất kho (Bán) / Không ảnh hưởng kho
// (Giới thiệu), bảng dòng + thành tiền + tổng.
// V2-G: mỗi dòng có chọn SP danh mục (gắn / gắn lại) → `PUT /contracts/:id/items/:itemId/product`; dòng đã phát sinh kho ⇒ 409 `ITEM_LOCKED`.
import type { ContractDeal, ContractItem } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { toast } from "~/components/shared/toast";
import { fetchProducts, PRODUCTS_KEY } from "~/features/contract-form/api";
import { ProductPicker } from "~/features/contract-form/components/ProductPicker";
import { STOCK_EFFECT } from "~/features/contract-form/lib/deal";
import type { LineState } from "~/features/contract-form/lib/form-model";
import { lineOfItem } from "~/features/contract-form/lib/review-model";
import { stockTone } from "~/features/contract-form/lib/stock-label";
import { contractKey, putItemProduct } from "../api";
import { saveErrorText } from "../lib/save-error";

const lineSum = (it: ContractItem): number | null =>
  it.qty != null && it.unit_price != null ? Math.round(it.qty * it.unit_price) : null;

/** Dòng + chọn SP: giữ lựa chọn cục bộ, lưu ngay khi đổi; lỗi ⇒ trả về giá trị đã lưu. */
function SavedRow({
  it,
  index,
  contractId,
  deal,
  write,
  onError,
}: {
  it: ContractItem;
  index: number;
  contractId: string;
  deal: ContractDeal;
  write: boolean;
  onError: (m: string | null) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const products = useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ signal }) => fetchProducts(signal),
    staleTime: 60_000,
  });
  const [line, setLine] = useState<LineState>(() => lineOfItem(it));
  const s = lineSum(it);
  const onPatch = async (p: Partial<LineState>) => {
    const next = { ...line, ...p };
    if (next.product_id === line.product_id && next.component_id === line.component_id) return;
    setLine(next);
    onError(null);
    try {
      await putItemProduct(contractId, it.id, {
        product_id: next.product_id || null,
        ...(next.product_id && next.component_id ? { component_ids: [next.component_id] } : {}),
      });
      toast(t("contracts.cdetail.attachSaved"));
      await qc.invalidateQueries({ queryKey: contractKey(contractId) });
    } catch (e) {
      setLine(line);
      onError(
        e instanceof ApiError && e.status === 409
          ? t("contracts.cdetail.itemLocked")
          : saveErrorText(e, t),
      );
    }
  };
  return (
    <>
      <tr className="border-t border-rule-soft">
        <td className="px-4 py-2.5 first:pl-5">{it.name}</td>
        <td className="px-4 text-right font-mono whitespace-nowrap">
          {it.qty ?? ""} <span className="text-dim">{it.unit ?? ""}</span>
        </td>
        <td className="px-4 text-right font-mono">{vnd(it.unit_price)}</td>
        <td className="px-4 text-right font-mono last:pr-5">{s === null ? "—" : vnd(s)}</td>
      </tr>
      {write && (
        <tr>
          <td colSpan={4} className="px-4 pb-3 pl-5">
            <ProductPicker
              line={line}
              index={index}
              deal={deal}
              products={products.data ?? []}
              invalid={false}
              allowNew={false}
              onPatch={(p) => void onPatch(p)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export function ProductsPanel({
  items,
  deal,
  contractId,
  write,
}: {
  items: readonly ContractItem[];
  deal: ContractDeal;
  contractId: string;
  write: boolean;
}) {
  const { t } = useTranslation();
  const [err, setErr] = useState<string | null>(null);
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
      {err && (
        <p role="alert" className="px-5 pt-2 text-sm text-late">
          {err}
        </p>
      )}
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
            {items.map((it, i) => (
              <SavedRow
                key={`${it.id}:${it.product_id ?? ""}:${(it.component_ids ?? []).join(",")}`}
                it={it}
                index={i}
                contractId={contractId}
                deal={deal}
                write={write}
                onError={setErr}
              />
            ))}
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
