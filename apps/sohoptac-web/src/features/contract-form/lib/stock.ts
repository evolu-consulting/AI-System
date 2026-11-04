// V2-F · BA 5.7e: tồn hiện có dưới dòng HĐ + cảnh báo "Bán vượt tồn" (chỉ HĐ Bán, thành phần giữ hàng). Thuần.
import type { ContractDeal, ProductOut } from "@ai/contracts";
import { parseQty } from "~/components/shared/format";

export type StockHint = { onHand: number; unit: string | null; short: boolean } | null;

/** Thành phần tính tồn: đã chọn thành phần ⇒ nó; SP một thành phần ⇒ thành phần đó; nhiều thành phần mà chưa chọn ⇒ chưa biết. */
export function stockComponent(p: ProductOut, componentId: string) {
  if (componentId) return p.components.find((c) => c.id === componentId) ?? null;
  return p.components.length === 1 ? (p.components[0] ?? null) : null;
}

/** Thành phần không giữ hàng (`order`/`none`) ⇒ không có tồn để nói tới ⇒ null. */
export function stockHint(
  p: ProductOut | undefined,
  componentId: string,
  qty: string,
  deal: ContractDeal,
): StockHint {
  if (!p) return null;
  const c = stockComponent(p, componentId);
  if (!c || (c.mode !== "stock" && c.mode !== "quota")) return null;
  const onHand = Number(c.on_hand);
  if (Number.isNaN(onHand)) return null;
  const q = parseQty(qty);
  const short = deal === "sell" && q !== null && !Number.isNaN(q) && q > onHand;
  return { onHand, unit: c.unit ?? p.unit, short };
}
