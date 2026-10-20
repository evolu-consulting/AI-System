// V2-J2 · luật hiển thị thuần của tab NCC & giá (không React): tab chỉ hiện cho SP không phải Giới thiệu, lọc Mua mới / Gia hạn,
// "Cũ" khi giá quá 180 ngày, dòng tìm giá → thân lưu.
import type {
  ProductGroup,
  SupplierPriceInput,
  SupplierPriceKind,
  SupplierPriceRow,
  SupplierSearchItem,
} from "@ai/contracts";

/** Tab "Nhà cung cấp & giá" không hiện cho SP nhóm Giới thiệu (BA SP-04). Slot tab của trang chi tiết (V2-J1) dùng hàm này. */
export const supplierTabVisible = (group: ProductGroup): boolean => group !== "referral";

/** Chỉ hiện nút Mua mới / Gia hạn khi có ít nhất một dòng Gia hạn; ngược lại luôn Mua mới (mockup `cmpPanel`). */
export const hasRenew = (rows: readonly SupplierPriceRow[]): boolean =>
  rows.some((r) => r.kind === "renew");

export const rowsOfKind = (rows: readonly SupplierPriceRow[], kind: SupplierPriceKind) =>
  rows.filter((r) => r.kind === kind);

export const OLD_DAYS = 180;
/** Giá cũ: ngày của giá cách hôm nay > 180 ngày (`today` = YYYY-MM-DD). */
export function isOld(on: string | null, today: string): boolean {
  if (!on) return false;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000;
  return days > OLD_DAYS;
}

/** Dòng kết quả AI người dùng chọn ⇒ thân `POST /supplier-prices` (nguồn `market`). */
export const toSaveItems = (items: readonly SupplierSearchItem[]): SupplierPriceInput[] =>
  items.map((i) => ({
    supplier_name: i.supplier_name,
    kind: i.kind,
    price: i.price,
    unit: i.unit,
    url: i.url,
    seen_on: i.seen_on,
    note: i.note,
    source: "market" as const,
  }));
