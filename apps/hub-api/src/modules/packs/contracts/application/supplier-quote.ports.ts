// com-c7 · ADR-0031 · R15–R28: cổng ghi DUY NHẤT từ gói khác vào SP & Giá — `SupplierQuoteWriter` ("Lưu báo giá"). Contracts CUNG CẤP
// (`saveQuoteUsecase`); gói cần (community) tự khai một kiểu cùng hình trong `application/*.ports.ts` của nó, `packs.mount.ts` tiêm
// (typecheck ở mount bắt lệch hợp đồng). DTO thuần, không lộ cột/bảng. Chưa nối community ở lát này.
import type { SupplierPriceKind } from "../domain/supplier-prices.types";
import type { PricedRow, QuotePreview } from "../domain/supplier-quote.rules";

/** Người gọi (từ phiên của gói gọi). `kind=external` (user đối tác) ⇒ từ chối (ADR-0031 §4). */
export type QuoteCaller = { tenantId: string; userId: string; kind: "internal" | "external" };

/** SP có sẵn (`product_id`) hoặc SP mới tạo cùng lúc (tên + đơn vị + nhóm). */
export type QuoteProduct =
  | { product_id: string }
  | { new_product: { name: string; unit: string | null; group: "goods" | "service" } };

export type QuoteSupplier = {
  /** Khoá đối tác đã biết (`tax:<MST>` / `name:<fold>`); vắng ⇒ suy từ MST/tên. */
  party_key?: string | null | undefined;
  name: string;
  tax_id?: string | null | undefined;
};

/** Nguồn ngoài SHT của giá (R23), vd `{ pack: "community", post_id, item_idx }`. */
export type QuoteOrigin = { pack: string } & Record<string, string | number | null>;

export type QuoteInput = QuoteProduct & {
  supplier: QuoteSupplier;
  /** Đồng, số nguyên. */
  price: number;
  unit: string | null;
  vat_included: boolean;
  /** R17 Mua mới / Gia hạn (`new` | `renew`; ≡ cột `kind` 0031). */
  kind: SupplierPriceKind;
  /** Ngày báo giá (YYYY-MM-DD) ⇒ `seen_on`. */
  quoted_at: string;
  expires_on?: string | null | undefined;
  origin_ref: QuoteOrigin;
  /** Link về bài (hiện ở SP & Giá). */
  url?: string | null | undefined;
};

export type QuoteSaved = QuotePreview & {
  price_id: string;
  product_id: string;
  product_created: boolean;
  supplier_party_key: string;
  /** NCC chưa có vai NCC ⇒ vừa tạo (điểm MỚI, R24). */
  supplier_created: boolean;
};

/** Cổng gói gọi. `preview` không ghi gì; `save` một tx RLS của người gọi. */
export type SupplierQuoteWriter = {
  preview(by: QuoteCaller, q: QuoteInput): Promise<QuotePreview>;
  save(by: QuoteCaller, q: QuoteInput): Promise<QuoteSaved>;
};

/** Repo trong tx (RLS tenant + GUC người gọi). Số câu cố định mỗi lần lưu (Luật 4c). */
export type SupplierQuoteRepo = {
  /** SP (nhóm, đơn vị) + giá đã lưu chưa thay/chưa gỡ của SP; SP không có/không thấy ⇒ null. */
  quoteBase(productId: string): Promise<{
    product: { unit: string | null; group: "service" | "goods" | "referral" };
    rows: PricedRow[];
  } | null>;
  /** Khoá theo (SP, NCC, loại) tới hết tx ⇒ hai người cùng lưu không để lại hai giá đang dùng (R28). */
  lockQuote(productId: string, partyKey: string, kind: SupplierPriceKind): Promise<void>;
  /** MỘT câu: đánh dấu thay giá Báo giá cũ + chèn giá mới + vai NCC nếu thiếu. SP không có ⇒ null. */
  saveQuote(
    productId: string,
    q: QuoteInput & { party_key: string },
  ): Promise<{ id: string; replaced: string[]; supplier_created: boolean } | null>;
};
