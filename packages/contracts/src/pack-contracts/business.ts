// V2-J1 · BA v2 §2 (Hai loại điểm) · §3.3 SP-01/02/07 · §5.2 · CD-06: điểm kinh doanh của sản phẩm + danh sách / chi tiết SP + cấu hình.
// `GET /pack/contracts/business/products`, `/business/products/:id`, `/business/products/:id/contracts`, `GET|PUT /business/config`.
// Tiền = số nguyên đồng (chưa VAT); SL = số (đã chia 10⁴, ≤ 4 số lẻ); ngày = `YYYY-MM-DD`.
import { z } from "zod";
import { PRODUCT_GROUPS, type ProductGroup } from "./products";

export const BIZ_ERRORS = { BUSINESS_INVALID: 422 } as const;

/** Đề xuất: SP đang giữ hàng ⇒ buy/hold/dump; không giữ ⇒ push/keep/stop; chưa có dữ liệu ⇒ null. */
export const BIZ_SUGGESTIONS = ["buy", "hold", "dump", "push", "keep", "stop"] as const;
export type BizSuggestion = (typeof BIZ_SUGGESTIONS)[number];

const pct = z.number().int().min(0).max(100);
/** CD-06 · trọng số + ngưỡng (mặc định BA: 40/35/25, 45 ngày, 150 ngày, 120%, 70%, 70, 45, mục tiêu 6, báo trước 60 ngày). */
export const BizConfigSchema = z.strictObject({
  w: z.strictObject({ rot: pct, margin: pct, trend: pct }),
  /** Giữ hàng kho: tồn đủ bán dưới N ngày (và điểm đủ cao) ⇒ Mua thêm. */
  buyDays: z.number().int().min(1).max(365),
  /** Tồn đủ bán trên N ngày ⇒ Xả hàng. */
  dumpDays: z.number().int().min(30).max(730),
  /** Gói suất: dự kiến bán ≥ N% số suất trước hạn (và điểm đủ cao) ⇒ Mua thêm. */
  quotaBuy: z.number().int().min(50).max(500),
  /** Gói suất: dự kiến bán dưới N% số suất ⇒ Xả hàng. */
  quotaDump: z.number().int().min(10).max(100),
  /** Không giữ hàng: điểm ≥ hi ⇒ Đẩy mạnh. */
  hi: z.number().int().min(50).max(95),
  /** Không giữ hàng: điểm < lo ⇒ Cân nhắc dừng. */
  lo: z.number().int().min(10).max(70),
  /** Mục tiêu số lượng bán / số HĐ giới thiệu trong 3 tháng. */
  vol: z.number().int().min(1).max(100000),
  /** Báo sắp hết hạn trước N ngày (gói suất, khách đang dùng — V2-H/V2-N đọc). */
  soon: z.number().int().min(1).max(365),
});
export type BizConfig = z.infer<typeof BizConfigSchema>;

/** "Thử tính" (CD-06): số mẫu một SP + cấu hình đang chỉnh ⇒ điểm, đề xuất, từng yếu tố. Không ghi gì. */
export const BizPreviewSchema = z.strictObject({
  config: BizConfigSchema,
  sample: z.strictObject({
    kind: z.enum(["stock", "quota", "order", "referral"]),
    /** SL đang giữ (kho / suất). */
    held: z.number().min(0).max(1_000_000),
    /** SL bán 3 tháng gần / 3 tháng trước. */
    l3: z.number().min(0).max(1_000_000),
    p3: z.number().min(0).max(1_000_000),
    /** Giá vốn / giá bán một đơn vị (đồng). */
    cost: z.number().min(0).max(1e12),
    price: z.number().min(0).max(1e12),
    /** Gói suất: số ngày tới hạn. */
    dte: z.number().int().min(0).max(3650),
  }),
});
export type BizPreviewIn = z.infer<typeof BizPreviewSchema>;

export const BizTabSchema = z.enum(["all", ...PRODUCT_GROUPS]);
export const BizListQuerySchema = z.strictObject({
  group: z.enum(PRODUCT_GROUPS).optional(),
  q: z.string().max(100).optional(),
});
export type BizListQuery = z.infer<typeof BizListQuerySchema>;

export type BizFactor = {
  key: "rot" | "margin" | "trend";
  /** Nhãn hiển thị (đổi theo loại SP: "Tốc độ bán", "Số lượng bán", "Thu được hoa hồng"…). */
  label: string;
  weight: number;
  /** 0–100; null ⇒ chưa có dữ liệu, bỏ khỏi điểm. */
  value: number | null;
  detail: string;
};
export type BizKind = "stock" | "quota" | "order" | "referral";
export type BizHeld = {
  /** Số lượng nắm giữ (thành phần ít nhất của SP gộp); 0 ⇒ không giữ. */
  qty: number;
  unit: string | null;
  /** Hạn sớm nhất của suất còn lại (gói có hạn). */
  expires_on: string | null;
  /** Giá trị tồn (đồng, BQ gia quyền). */
  value: number;
};
export type BizScore = {
  score: number | null;
  suggestion: BizSuggestion | null;
  reason: string;
  factors: BizFactor[];
};
export type BizProductRow = {
  id: string;
  name: string;
  unit: string | null;
  group: ProductGroup;
  kind: BizKind;
  held: BizHeld;
  /** Đã bán 12 tháng (SL; Giới thiệu = số HĐ). */
  sold_12m: number;
  sold_3m: number;
  business: BizScore;
};
export type BizListOut = { items: BizProductRow[]; counts: Record<"all" | ProductGroup, number> };

export type BizLotOut = {
  id: string;
  received_on: string;
  qty: number;
  remaining: number;
  /** Giá nhập (đồng/đơn vị); null ⇒ HĐ nhập lô người xem không thấy. */
  unit_cost: number | null;
  /** Chênh giá so với lô trước của cùng thành phần (đồng/đơn vị); null ⇒ lô đầu. */
  price_change: number | null;
  expires_on: string | null;
  supplier: string | null;
  contract_id: string | null;
  component: string;
};
export type BizSaleOut = {
  on: string;
  contract_id: string;
  contract_title: string;
  customer: string | null;
  qty: number;
  unit_price: number | null;
  /** Giá vốn xuất (đồng); null ⇒ không có (đặt theo khách / chưa gắn kho). */
  cost: number | null;
  profit: number | null;
};
export type BizDetailOut = {
  product: BizProductRow;
  /** Chỉ số 12 tháng của SP: doanh thu (SL × giá bán) và biên lãi nếu có giá vốn. */
  revenue_12m: number;
  margin_pct: number | null;
  lots: BizLotOut[];
  sales: BizSaleOut[];
  contracts_count: number;
};
export type BizContractOut = {
  id: string;
  title: string;
  number: string | null;
  deal: "buy" | "sell" | "referral" | null;
  status: string;
  partner: string | null;
  value: number | null;
  start_date: string | null;
  /** Giới thiệu: hoa hồng phát sinh / đã nhận (đồng). */
  commission_total: number | null;
  commission_received: number | null;
};
export type BizConfigOut = {
  config: BizConfig;
  defaults: BizConfig;
  version: number;
  updated_at: string | null;
};
