// V2-G · BA v2 §3.1 HD-02/HD-08 · §4.2 "Upload và xác nhận" · §5.5: màn xác nhận sau khi AI đọc — `POST /pack/contracts/contracts/:id/review`
// (Lưu: trường + loại HĐ + dòng hàng + mốc, MỘT tx) và `PUT /contracts/:id/items/:itemId/product` (gắn / gắn lại SP cho dòng HĐ đã lưu).
import { z } from "zod";
import { VersionSchema } from "../common";
import { CONTRACT_FIELD_KEYS, fieldValueSchema, nfcText } from "./fields";
import { IsoDay, LedgerMoney } from "./ledger";
import {
  ContractDealSchema,
  MILESTONE_TITLE_MAX,
  MILESTONES_MAX,
  MilestoneKindSchema,
} from "./milestones";
import { ProductLinksSchema } from "./product-links";

const REVIEW_ITEMS_MAX = 500;
const COMPONENTS_MAX = 20;
const money = LedgerMoney;
const pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === v * 100, "tối đa 2 chữ số thập phân");

const optText = (max: number) => nfcText(max).nullable().optional();

/** Dòng hàng của màn xác nhận: có `id` ⇒ sửa dòng AI đã đọc (chỗ trống = null); không `id` ⇒ dòng thêm mới. Không xoá dòng (D-08). */
export const ReviewItemSchema = z
  .strictObject({
    id: z.uuid().optional(),
    name: nfcText(500).min(1),
    unit: optText(50),
    qty: z.number().min(0).max(1e12).nullable().optional(),
    unit_price: money.nullable().optional(),
    product_id: z.uuid().nullable().optional(),
    component_ids: z.array(z.uuid()).min(1).max(COMPONENTS_MAX).nullable().optional(),
  })
  .refine((i) => !i.component_ids?.length || !!i.product_id, {
    message: "thành phần cần có sản phẩm",
    path: ["component_ids"],
  });
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

/** Mốc người đã xem trên màn xác nhận (AI tìm thấy, người có thể bỏ/sửa). Số tiền chỉ cho mốc tiền (luật V2-A, 422 `MILESTONE_INVALID`). */
export const ReviewMilestoneSchema = z.strictObject({
  kind: MilestoneKindSchema,
  title: nfcText(MILESTONE_TITLE_MAX).min(1).nullish(),
  due_date: IsoDay,
  amount: money.nullish(),
});
export type ReviewMilestone = z.infer<typeof ReviewMilestoneSchema>;

const PATCH_SHAPE = Object.fromEntries(
  CONTRACT_FIELD_KEYS.map((k) => [k, fieldValueSchema(k).optional()]),
) as { [K in (typeof CONTRACT_FIELD_KEYS)[number]]: z.ZodOptional<z.ZodNullable<z.ZodType>> };

/** Lưu ở màn xác nhận. `fields`/`items`/`milestones` vắng ⇒ giữ nguyên; `milestones` có ⇒ thay bộ mốc AI/mặc định chưa xác nhận.
 *  `deal` đổi được tới khi HĐ ở trạng thái đã xác nhận (DB khoá). Hoa hồng chỉ cho Giới thiệu. */
export const ReviewSaveRequestSchema = z
  .strictObject({
    version: VersionSchema,
    deal: ContractDealSchema.optional(),
    commission_pct: pct.nullable().optional(),
    commission_fixed: money.nullable().optional(),
    fields: z.strictObject(PATCH_SHAPE).optional(),
    items: z.array(ReviewItemSchema).max(REVIEW_ITEMS_MAX).optional(),
    milestones: z.array(ReviewMilestoneSchema).max(MILESTONES_MAX).optional(),
    /** "Lưu nháp": chỉ ghi, HĐ giữ `needs_review` (không xác nhận / khoá) kể cả khi tenant tắt duyệt. */
    draft: z.boolean().optional(),
    /** atomic-confirm: tenant tắt duyệt — gắn/tạo SP cho dòng HĐ (đã lưu) trong CÙNG tx xác nhận; lỗi ⇒ ROLLBACK cả lệnh.
     *  Chỉ cho lệnh xác nhận (không `draft`); bật duyệt (HĐ còn chờ) ⇒ bỏ qua — SP gắn ở bước duyệt cuối. */
    products: ProductLinksSchema.optional(),
  })
  .refine((b) => (b.commission_pct ?? null) === null || (b.commission_fixed ?? null) === null, {
    message: "chọn % hoặc số tiền cố định",
    path: ["commission_fixed"],
  })
  .refine((b) => !(b.draft && b.products?.length), {
    message: "gắn sản phẩm chỉ khi xác nhận (không lưu nháp)",
    path: ["products"],
  });
export type ReviewSaveRequest = z.infer<typeof ReviewSaveRequestSchema>;

/** `status = active` khi tenant tắt duyệt (HĐ lưu là có hiệu lực, V2-A C3); bật duyệt ⇒ `needs_review` (còn bước Xác nhận). */
export const ReviewSaveResponseSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["needs_review", "active"]),
  version: VersionSchema,
  items: z.number().int().min(0),
  milestones: z.number().int().min(0),
});
export type ReviewSaveResponse = z.infer<typeof ReviewSaveResponseSchema>;

/** Gắn / gắn lại SP cho dòng HĐ đã lưu (khối "Sản phẩm" ở chi tiết). `product_id: null` ⇒ gỡ. */
export const ItemProductRequestSchema = z
  .strictObject({
    product_id: z.uuid().nullable(),
    component_ids: z.array(z.uuid()).min(1).max(COMPONENTS_MAX).nullable().optional(),
  })
  .refine((b) => !b.component_ids?.length || !!b.product_id, {
    message: "thành phần cần có sản phẩm",
    path: ["component_ids"],
  });
export type ItemProductRequest = z.infer<typeof ItemProductRequestSchema>;

export const ItemProductResponseSchema = z.strictObject({
  id: z.uuid(),
  product_id: z.uuid().nullable(),
  component_ids: z.array(z.uuid()).nullable(),
});
export type ItemProductResponse = z.infer<typeof ItemProductResponseSchema>;
