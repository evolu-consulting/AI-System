// products-confirm · BA 5.5 (khách 2026-10-22): SP chỉ được tạo/gắn từ dòng HĐ khi HĐ ĐÃ XÁC NHẬN. Hộp "Gắn sản phẩm" lúc xác nhận:
// mỗi dòng chọn "dùng SP có sẵn" (`product_id`) hoặc "tạo SP mới" (`new_product`). `POST /contracts/:id/product-links` (write) và
// trường `products` của `POST /contracts/:id/approval` (áp trong cùng tx với bước duyệt cuối).
import { z } from "zod";
import { PRODUCT_GROUPS } from "./products";

export const PRODUCT_LINKS_MAX = 500;

export const ProductLinkSchema = z.union([
  z.strictObject({ item_id: z.uuid(), product_id: z.uuid() }),
  z.strictObject({
    item_id: z.uuid(),
    new_product: z.strictObject({
      name: z.string().trim().min(1).max(300),
      unit: z.string().trim().min(1).max(40).nullish(),
      group: z.enum(PRODUCT_GROUPS),
    }),
  }),
]);
export type ProductLink = z.infer<typeof ProductLinkSchema>;
export const ProductLinksSchema = z.array(ProductLinkSchema).max(PRODUCT_LINKS_MAX);

export const ProductLinksRequestSchema = z.strictObject({ links: ProductLinksSchema });
export type ProductLinksRequest = z.infer<typeof ProductLinksRequestSchema>;

export const ProductLinksResultSchema = z.strictObject({
  /** SP mới thật sự tạo (trùng tên SP có sẵn ⇒ gắn SP đó, không tạo). */
  created: z.number().int(),
  /** Dòng HĐ đã gắn SP. */
  linked: z.number().int(),
});
export type ProductLinksResult = z.infer<typeof ProductLinksResultSchema>;

export const PRODUCT_LINK_ERRORS = {
  /** HĐ chưa xác nhận (chờ xác nhận / đang đọc / lỗi / từ chối) ⇒ chưa được tạo/gắn SP. */
  CONTRACT_NOT_CONFIRMED: 409,
  /** HĐ đã có dòng kho ⇒ không đổi SP của dòng. */
  ITEMS_LOCKED: 409,
} as const;
