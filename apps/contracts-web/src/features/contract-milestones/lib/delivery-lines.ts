// delivery-opts · luật thuần của bảng "Giao đợt này" trong hộp xác nhận mốc giao: bản nháp SL từng dòng (chuỗi kiểu Việt) ↔ thân
// `PATCH /milestones/:id { items }`, nhận biết có sửa so với SL máy tính sẵn, và câu liệt kê thành phần thiếu kho.
import type { DeliveryView, StockCheckOut } from "@ai/contracts";
import { parseQty } from "~/components/shared/format";

export type LineDraft = {
  item_id: string;
  name: string;
  unit: string | null;
  product_id: string | null;
  on_contract: string | null;
  delivered: string;
  remaining: string | null;
  /** SL máy tính sẵn (theo %, hoặc phần còn lại) — để biết người dùng có sửa không. */
  initial: string;
  /** Ô nhập (kiểu Việt "1,5"). */
  qty: string;
};

const show = (s: string): string => s.replace(".", ",");

export function draftsOf(v: DeliveryView): LineDraft[] {
  return v.rows
    .filter((r) => r.on_contract !== null)
    .map((r) => ({
      item_id: r.item_id,
      name: r.name,
      unit: r.unit,
      product_id: r.product_id,
      on_contract: r.on_contract,
      delivered: r.delivered,
      remaining: r.remaining,
      initial: show(r.this_time),
      qty: show(r.this_time),
    }));
}

export type LinesEdit = {
  /** Có dòng khác SL tính sẵn ⇒ phải lưu bảng SL trước khi xác nhận. */
  dirty: boolean;
  /** Có ô không đọc được / âm / vượt phần còn lại. */
  bad: boolean;
  items: { item_id: string; qty: number }[];
};

export function editOf(rows: readonly LineDraft[]): LinesEdit {
  let bad = false;
  const items = rows.map((r) => {
    const q = r.qty.trim() === "" ? 0 : parseQty(r.qty);
    const n = q === null || Number.isNaN(q) || q < 0 ? Number.NaN : q;
    const left = r.remaining === null ? Number.POSITIVE_INFINITY : Number(r.remaining);
    if (Number.isNaN(n) || n > left) bad = true;
    return { item_id: r.item_id, qty: Number.isNaN(n) ? 0 : n };
  });
  const dirty = rows.some((r) => r.qty.trim() !== r.initial.trim());
  return { dirty, bad, items };
}

/** Yêu cầu kiểm tồn từ bảng (chỉ dòng có SP và SL > 0). */
export function checkBody(rows: readonly LineDraft[]) {
  const items = editOf(rows)
    .items.map((x, i) => ({ qty: x.qty, product_id: rows[i]?.product_id ?? null }))
    .filter((x): x is { qty: number; product_id: string } => x.product_id !== null && x.qty > 0);
  return items.length ? { items } : null;
}

/** "Băng keo (cần 50, còn 20)" cho các thành phần thiếu kho; rỗng = đủ. */
export const shortList = (c: StockCheckOut | null): string =>
  (c?.components ?? [])
    .filter((x) => x.over)
    .map((x) => `${x.name} (${x.need} / ${x.on_hand})`)
    .join("; ");
