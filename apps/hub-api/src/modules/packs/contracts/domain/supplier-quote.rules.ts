// com-c7 · CR-102b · R18–R22 (nghiep-vu community §8): luật thuần "Lưu báo giá" — trạng thái một giá đã lưu (còn hiệu lực / hết
// hạn / đã thay / đã gỡ), so giá với giá đang có của SP (bằng / rẻ / đắt / giá đầu tiên), cảnh báo lệch > 30% và khác VAT, các giá
// Báo giá sẽ bị thay. Dùng cho cả xem trước (form) lẫn lưu; không DB/mạng.
import { foldVi } from "./fold.rules";
import type { SupplierPriceKind } from "./supplier-prices.types";

/** Lệch quá ngưỡng này (%, so với giá so) ⇒ cảnh báo; vẫn cho lưu. */
export const DEVIATION_PCT = 30;

export type PriceStatus = "live" | "expired" | "replaced" | "removed";

/** Các cột trạng thái của một dòng `product_supplier_prices` (CR-102b; dòng cũ: null hết). */
export type PriceLife = {
  expires_on?: string | null | undefined;
  replaced_at?: string | null | undefined;
  removed_at?: string | null | undefined;
};

/** Một giá đã lưu đủ để so / quyết thay. */
export type PricedRow = PriceLife & {
  id: string;
  supplier_name: string;
  party_key: string | null;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  source: "market" | "quote" | "manual";
  vat_included?: boolean | null | undefined;
};

/** Giá Báo giá định lưu. `party_key` = khoá đối tác NCC (≡ `contracts.party_key`). */
export type QuoteDraft = {
  party_key: string;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  vat_included: boolean;
};

export type QuoteCompare =
  | { kind: "first" }
  | {
      kind: "equal" | "cheaper" | "dearer";
      /** Giá so = giá rẻ nhất còn hiệu lực cùng loại + cùng đơn vị. */
      ref_price: number;
      ref_supplier: string;
      /** Giá mới − giá so (đồng; âm = rẻ hơn). */
      diff: number;
      pct: number;
    };
export type QuoteWarning =
  | { code: "deviation"; pct: number; ref_price: number }
  | { code: "vat_differs"; ref_price: number };
export type QuotePreview = {
  compare: QuoteCompare;
  warnings: QuoteWarning[];
  /** Id các giá Báo giá cũ sẽ được đánh dấu "Đã thay" khi lưu (R22). */
  replaces: string[];
};

/** Gỡ > đã thay > hết hạn (`expires_on` < hôm nay, theo ngày tenant) > còn hiệu lực. */
export function priceStatus(p: PriceLife, today: string): PriceStatus {
  if (p.removed_at) return "removed";
  if (p.replaced_at) return "replaced";
  if (p.expires_on && p.expires_on < today) return "expired";
  return "live";
}
export const isLive = (p: PriceLife, today: string): boolean => priceStatus(p, today) === "live";

const unitKey = (u: string | null | undefined, productUnit: string | null) =>
  foldVi((u ?? productUnit ?? "").trim());

/** % lệch có dấu, 1 số lẻ. */
const pctOf = (price: number, ref: number) => Math.round(((price - ref) / ref) * 1000) / 10;

/** R22: giá Báo giá cùng NCC + cùng loại, chưa thay/chưa gỡ (đã hết hạn vẫn bị thay). Khớp câu SQL `replace` của repo. */
export const replacedBy = (r: PricedRow, d: Pick<QuoteDraft, "party_key" | "kind">): boolean =>
  r.source === "quote" &&
  !r.replaced_at &&
  !r.removed_at &&
  r.party_key === d.party_key &&
  r.kind === d.kind;

function compareTo(d: QuoteDraft, ref: PricedRow | undefined): QuoteCompare {
  if (!ref) return { kind: "first" };
  const diff = d.price - ref.price;
  return {
    kind: diff === 0 ? "equal" : diff < 0 ? "cheaper" : "dearer",
    ref_price: ref.price,
    ref_supplier: ref.supplier_name,
    diff,
    pct: pctOf(d.price, ref.price),
  };
}

function warningsOf(d: QuoteDraft, ref: PricedRow | undefined, c: QuoteCompare): QuoteWarning[] {
  if (!ref || c.kind === "first") return [];
  const out: QuoteWarning[] = [];
  if (Math.abs(c.pct) > DEVIATION_PCT)
    out.push({ code: "deviation", pct: c.pct, ref_price: ref.price });
  if (typeof ref.vat_included === "boolean" && ref.vat_included !== d.vat_included)
    out.push({ code: "vat_differs", ref_price: ref.price });
  return out;
}

/** Xem trước = kết quả lưu sẽ trả: so với giá rẻ nhất còn hiệu lực (cùng loại, cùng đơn vị), cảnh báo, giá sẽ thay. */
export function previewQuote(
  d: QuoteDraft,
  rows: readonly PricedRow[],
  c: { today: string; productUnit: string | null },
): QuotePreview {
  const unit = unitKey(d.unit, c.productUnit);
  const ref = rows
    .filter(
      (r) => isLive(r, c.today) && r.kind === d.kind && unitKey(r.unit, c.productUnit) === unit,
    )
    .sort((a, b) => a.price - b.price)[0];
  const compare = compareTo(d, ref);
  return {
    compare,
    warnings: warningsOf(d, ref, compare),
    replaces: rows.filter((r) => replacedBy(r, d)).map((r) => r.id),
  };
}

/** Lỗi nghiệp vụ của thân lưu (ngoài schema): hạn trước ngày báo giá. */
export function quoteInvalid(q: {
  quoted_at: string;
  expires_on?: string | null | undefined;
}): "expires_before_quote" | null {
  return q.expires_on && q.expires_on < q.quoted_at ? "expires_before_quote" : null;
}
