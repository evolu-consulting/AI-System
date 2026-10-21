// V2-J2 · BA v2 §3.3 SP-04/05/06 · §4.4 (intake V2-J2): tab "Nhà cung cấp & giá" của chi tiết sản phẩm.
// `GET /pack/contracts/products/:id/suppliers` (so sánh NCC với giá vốn BQ + gợi ý hợp tác), `POST .../suppliers/search` (AI tìm giá
// trên mạng — chỉ khi người dùng bấm, chỉ gửi TÊN sản phẩm), `POST .../supplier-prices` (lưu kết quả vào bảng so sánh),
// `DELETE .../supplier-prices/:priceId`. Thay `/cks/scans`. Tiền = số nguyên đồng (chưa VAT).
// price-scout: lượt tìm nay qua agent Hub `price-scout`, gửi tên SP + cấu hình dò của SP (xem `price-scout.ts`).
import { z } from "zod";

export const SUPPLIER_PRICE_ERRORS = {
  /** AI chưa cấu hình / CLI gói chưa đăng nhập. */
  SEARCH_UNAVAILABLE: 503,
  /** Trần token AI của tenant trong ngày. */
  SEARCH_CAP: 429,
  /** AI trả lỗi / trả sai dạng. */
  SEARCH_FAILED: 502,
  /** price-scout · hết trần lượt dò giá (hoặc token) tháng này của tenant. */
  SCOUT_MONTHLY_CAP: 429,
  /** gap-d1 #21 · tải báo giá: tệp không phải PDF/văn bản · không đọc được chữ (PDF scan/hỏng) · quá lớn. */
  QUOTE_UNSUPPORTED: 415,
  QUOTE_UNREADABLE: 422,
  QUOTE_TOO_LARGE: 413,
} as const;
export type SupplierPriceErrorCode = keyof typeof SUPPLIER_PRICE_ERRORS;

/** Mua mới / Gia hạn (BA SP-04). */
export const SUPPLIER_PRICE_KINDS = ["new", "renew"] as const;
export type SupplierPriceKind = (typeof SUPPLIER_PRICE_KINDS)[number];
/** Nguồn giá trong bảng: `purchase` = giá đã nhập kho (sổ kho); `market` = AI tìm; `quote` = báo giá; `manual` = nhập tay. */
export const SUPPLIER_PRICE_SOURCES = ["purchase", "market", "quote", "manual"] as const;
export type SupplierPriceSource = (typeof SUPPLIER_PRICE_SOURCES)[number];
/** 4 gợi ý (BA SP-06). */
export const SUPPLIER_ADVICE = ["keep", "backup", "replace", "trial"] as const;
export type SupplierAdvice = (typeof SUPPLIER_ADVICE)[number];

export const SUPPLIER_PRICES_SAVE_MAX = 20;
const PRICE_MAX = 1_000_000_000_000;

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      return /^https?:$/.test(new URL(u).protocol);
    } catch {
      return false;
    }
  }, "url");

/** Một dòng giá NCC (kết quả AI hoặc người dùng nhập). */
export const SupplierPriceInputSchema = z.strictObject({
  supplier_name: z.string().trim().min(1).max(300),
  supplier_tax_id: z.string().trim().max(30).nullish(),
  kind: z.enum(SUPPLIER_PRICE_KINDS),
  price: z.number().int().min(1).max(PRICE_MAX),
  unit: z.string().trim().min(1).max(40).nullish(),
  url: httpUrl.nullish(),
  seen_on: z.iso.date().nullish(),
  note: z.string().trim().max(500).nullish(),
  source: z.enum(["market", "quote", "manual"]),
});
export type SupplierPriceInput = z.infer<typeof SupplierPriceInputSchema>;

export const SupplierPricesSaveSchema = z.strictObject({
  items: z.array(SupplierPriceInputSchema).min(1).max(SUPPLIER_PRICES_SAVE_MAX),
});
export type SupplierPricesSave = z.infer<typeof SupplierPricesSaveSchema>;

/** Thân tìm giá rỗng: tên sản phẩm lấy từ DB, người gọi không đưa gì khác ra ngoài. */
export const SupplierSearchSchema = z.strictObject({});

export type SupplierSearchItem = {
  supplier_name: string;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  url: string | null;
  seen_on: string | null;
  note: string | null;
};
export type SupplierSearchOut = { query: string; items: SupplierSearchItem[] };

/** gap-d1 #21 · `POST /products/:id/supplier-prices/read-quote` (multipart `file`, PDF hoặc văn bản ≤ 5 MiB): AI đọc báo giá ⇒ dòng giá
 *  CHƯA LƯU (người dùng chọn rồi "Lưu làm giá tham khảo" qua `POST /supplier-prices`, nguồn `quote`). */
export const QUOTE_MAX_BYTES = 5 * 1024 * 1024;
export type QuoteReadOut = { items: SupplierSearchItem[] };

export type SupplierPriceRow = {
  /** Id dòng đã lưu; null = dòng suy ra từ sổ kho (`purchase`). */
  id: string | null;
  supplier_name: string;
  party_key: string | null;
  kind: SupplierPriceKind;
  price: number;
  unit: string | null;
  source: SupplierPriceSource;
  url: string | null;
  /** Ngày của giá (ngày nhập kho / ngày thấy giá). */
  on: string | null;
  /** Chênh so với giá vốn BQ của mình (%; null khi chưa có giá vốn). */
  vs_own_pct: number | null;
  /** Uy tín NCC (V2-E vai NCC); null khi chưa có việc nào. */
  reputation: { score: number | null; level: "good" | "fair" | "watch" | "new" } | null;
};
export type SupplierSummaryRow = {
  supplier_name: string;
  party_key: string;
  /** Tổng SL đã nhập từ NCC (chuỗi thập phân), số lần nhập, tổng tiền, lần nhập cuối. */
  bought_qty: string;
  bought_times: number;
  bought_amount: number;
  /** Tỉ trọng tiền đã nhập của NCC trong tổng đã nhập của SP (%, làm tròn). */
  share_pct: number;
  last_on: string | null;
  /** Giá nhập gần nhất + giá thấp nhất đang có của NCC trong bảng. */
  last_price: number | null;
  best_price: number;
  reputation: SupplierPriceRow["reputation"];
  /** null = chưa đủ cơ sở để gợi ý (chưa mua, giá cao hoặc uy tín kém). */
  advice: SupplierAdvice | null;
};
export type SupplierOverviewOut = {
  product: {
    id: string;
    name: string;
    unit: string | null;
    group: "service" | "goods" | "referral";
  };
  /** Giá vốn BQ của mình (đồng/đơn vị SP); null khi chưa có kho. */
  own_avg_cost: number | null;
  rows: SupplierPriceRow[];
  suppliers: SupplierSummaryRow[];
};
