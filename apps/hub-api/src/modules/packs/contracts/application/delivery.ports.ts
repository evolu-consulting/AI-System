// V2-D · HD-05 · BA §5.7: cổng repo của mốc giao ⇒ kho (lớp 2 — chỉ kiểu). Mỗi hàm = MỘT câu SQL trong tx `PackUow` (RLS tenant
// + M1), trừ `apply` = `applyDelivery` của V2-B (4 câu cố định). Thứ tự khoá: HĐ → mốc (ledger) → thành phần (`apply`).
import type { DeliveryMove, DeliveryResult, StockMode } from "../domain/stock.rules";

export type DeliveryItemRow = {
  id: string;
  name: string;
  unit: string | null;
  qty: string | null;
  unit_price: number | null;
  product_id: string | null;
  component_ids: string[] | null;
  /** Σ đã giao (mọi mốc đã xác nhận, gồm chính mốc nếu đã xác nhận). */
  delivered: string;
};
export type DeliveryCompRow = {
  id: string;
  product_id: string;
  name: string;
  unit: string | null;
  mode: StockMode;
  ord: number;
};
export type DeliveryLoad = {
  contract_id: string;
  deal: "buy" | "sell" | "referral" | null;
  end_date: string | null;
  supplier: string | null;
  status: "open" | "done" | "cancelled";
  kind: string;
  /** SL chung cũ của mốc (V2-A). */
  qty: string | null;
  items: DeliveryItemRow[];
  /** Bảng SL của mốc: `qty` = Giao lần này (null = phần còn lại), `delivered` = đã giao khi xác nhận. */
  plan: { item_id: string; qty: string | null; delivered: string | null }[];
  comps: DeliveryCompRow[];
};
export type StockRow = {
  id: string;
  product_id: string;
  name: string;
  mode: StockMode;
  on_hand: string;
};

export type DeliveryRepo = {
  /** Mốc (chưa gỡ) + HĐ + dòng HĐ + đã giao + bảng SL + thành phần các SP của HĐ; null = không thấy. */
  load(milestoneId: string): Promise<DeliveryLoad | null>;
  /** Dòng HĐ + đã giao (lưu bảng SL của mốc). */
  contractItems(contractId: string): Promise<DeliveryItemRow[]>;
  /** Thay bảng SL (dòng chưa giao) của mốc mở. */
  replacePlan(
    milestoneId: string,
    contractId: string,
    rows: { item_id: string; qty: string | null }[],
  ): Promise<void>;
  /** Ghi kho một lần giao (V2-B `applyDelivery`). */
  apply(moves: readonly DeliveryMove[], on: string): Promise<DeliveryResult>;
  /** Thành phần + tồn của các SP (kiểm tồn khi lưu HĐ bán). */
  stockOf(productIds: readonly string[]): Promise<StockRow[]>;
};

export class DeliveryFail extends Error {
  constructor(
    readonly kind: "not_found" | "over" | "invalid" | "insufficient" | "locked",
    readonly detail: string = kind,
    readonly shortages: { component_id: string; name: string; need: string; have: string }[] = [],
  ) {
    super(detail);
  }
}
