// V2-D · BA v2 §5.7a-d · HD-05: xác nhận mốc giao ⇒ kho. Bảng SL của mốc (`items` trên `POST/PATCH …/milestones`), xem bảng
// Trên HĐ · Đã giao · Giao lần này (`GET /milestones/:id/delivery`), phần `delivery` trong phản hồi `POST /obligations/:id/settle`,
// kiểm tồn khi lưu HĐ bán (`POST /stock/check`, 5.7b/e — cảnh báo, không chặn). SL vào = số ≤ 4 số lẻ; SL ra = chuỗi thập phân.
import { z } from "zod";

export const DELIVERY_ERRORS = {
  /** Giao vượt phần còn lại trên HĐ (lưu mốc hoặc xác nhận). */
  DELIVERY_OVER: 422,
  /** Dòng mua thiếu đơn giá, gói suất thiếu ngày kết thúc HĐ, thành phần không thuộc SP… */
  DELIVERY_INVALID: 422,
  /** Bán vượt tồn khi xác nhận ⇒ chặn (`details.shortages`). */
  STOCK_INSUFFICIENT: 409,
  /** Mốc giao đã ghi kho ⇒ không huỷ xác nhận (đảo kho khi xoá HĐ — V2-M). */
  DELIVERY_LOCKED: 409,
} as const;
export type DeliveryErrorCode = keyof typeof DELIVERY_ERRORS;
export const DELIVERY_PLAN_MAX = 200;
export const STOCK_CHECK_MAX = 200;

const qty = z
  .number()
  .min(0)
  .max(99_999_999_999_999)
  .refine((v) => Math.round(v * 10_000) === v * 10_000, "tối đa 4 chữ số thập phân");

/** Một dòng "Giao lần này": `qty` null = giao hết phần còn lại của dòng. Dòng không có trong bảng = không giao đợt đó. */
export const MilestonePlanRowSchema = z.strictObject({
  item_id: z.uuid(),
  qty: qty.nullable(),
});
export const MilestonePlanSchema = z.array(MilestonePlanRowSchema).max(DELIVERY_PLAN_MAX);
export type MilestonePlanRow = z.infer<typeof MilestonePlanRowSchema>;

export type DeliveryViewRow = {
  item_id: string;
  name: string;
  unit: string | null;
  product_id: string | null;
  /** Trên HĐ (null = dòng không ghi SL). */
  on_contract: string | null;
  /** Đã giao ở các mốc ĐÃ xác nhận khác. */
  delivered: string;
  /** Giao lần này (mốc đã xác nhận: SL đã giao ở mốc này). */
  this_time: string;
  /** Còn được giao = Trên HĐ − Đã giao (trần của "Giao lần này"; null = dòng không ghi SL). */
  remaining: string | null;
};
export type DeliveryView = {
  milestone_id: string;
  status: string;
  rows: DeliveryViewRow[];
  /** Đợt giao theo % của mốc (null = không ghi %): "Giao lần này" mặc định = làm tròn(% × SL HĐ); đợt cuối lấy phần còn lại. */
  pct: number | null;
  /** Cài đặt tenant "cho phép giao vượt tồn" (mặc định tắt). */
  allow_negative: boolean;
};

/** Phần thêm vào phản hồi xác nhận mốc giao (chỉ khi mốc có dòng HĐ được giao). */
export type DeliveryOutcome = {
  items: { item_id: string; qty: string }[];
  stock: {
    component_id: string;
    product_id: string;
    name: string;
    mode: "stock" | "quota" | "order" | "none";
    on_hand_before: string;
    on_hand_after: string;
    avg_cost_before: number;
    avg_cost_after: number;
  }[];
  /** BA 5.7d: "kho Băng keo 5cm: 320 → 620", "giá vốn …: a → b". */
  notes: string[];
  /** Giao vượt tồn (cài đặt cho phép): thành phần thiếu kho nhưng vẫn giao ("giao vượt tồn N"). */
  overdrawn?: { component_id: string; name: string; need: string; have: string }[];
};

export const StockCheckRequestSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        product_id: z.uuid(),
        component_ids: z.array(z.uuid()).min(1).max(20).nullish(),
        qty,
      }),
    )
    .max(STOCK_CHECK_MAX),
});
export type StockCheckRequest = z.infer<typeof StockCheckRequestSchema>;
export type StockCheckOut = {
  /** Có thành phần giữ hàng mà tổng SL bán > tồn hiện tại (vẫn cho lưu — hàng có thể về trước ngày giao). */
  over_stock: boolean;
  components: {
    component_id: string;
    product_id: string;
    name: string;
    mode: "stock" | "quota";
    need: string;
    on_hand: string;
    over: boolean;
  }[];
};
