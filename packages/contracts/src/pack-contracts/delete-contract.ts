// V2-M · BA v2 HD-07 · 5.5e · 6a · C7: xoá hẳn một HĐ. `GET /contracts/:id/delete-preview` liệt kê tác động (hộp xác nhận),
// `DELETE /contracts/:id` xoá trong MỘT tx (chỉ vai quản lý `contracts-owner` = quyền `admin`). Không hoàn tác.
import { z } from "zod";

export const DELETE_CONTRACT_ERRORS = {
  /** Đảo kho không được (hàng nhập từ HĐ này đã xuất bán nơi khác) ⇒ chặn, không xoá gì. */
  DELETE_STOCK_BLOCKED: 409,
} as const;
export type DeleteContractErrorCode = keyof typeof DELETE_CONTRACT_ERRORS;

export const DeleteImpactSchema = z.object({
  contract: z.object({ id: z.uuid(), number: z.string().nullable(), title: z.string() }),
  milestones: z.number().int(),
  delivered_lines: z.number().int(),
  /** Dòng kho sẽ được đảo (nhập ⇒ trừ lại, xuất ⇒ trả lại). */
  stock: z.array(
    z.object({
      product: z.string(),
      component: z.string(),
      direction: z.enum(["in", "out"]),
      qty: z.string(),
    }),
  ),
  service_customers: z.number().int(),
  /** Tên SP gắn với HĐ này mà không còn HĐ nào khác dùng (= tên của `orphan_products`). Không tự xoá. */
  products: z.array(z.string()),
  /** products-confirm: SP gắn với HĐ (dòng HĐ / sinh từ HĐ) mà không HĐ nào khác dùng ⇒ người xoá chọn có xoá theo không. */
  orphan_products: z.array(z.object({ id: z.uuid(), name: z.string() })),
  partner_events: z.number().int(),
  /** Số phụ lục xoá theo (cascade). */
  appendices: z.number().int(),
  /** CR-101 R36: xoá HĐ nguyên tắc ⇒ số chứng từ con thấy được (bản hiện hành) được giữ và thành đứng riêng. */
  frame_children: z.number().int().optional(),
  /** Có liên kết CKS ⇒ gỡ liên kết (không chặn). */
  has_cks: z.boolean(),
  /** Lý do KHÔNG xoá được (kho không đảo được) — null = xoá được. */
  stock_blocked: z.string().nullable(),
});
export type DeleteImpact = z.infer<typeof DeleteImpactSchema>;

/** Thân (tuỳ chọn) của `DELETE /contracts/:id`: SP người xoá đã tick để xoá theo; chỉ SP thuộc `orphan_products` mới bị xoá. */
export const DeleteContractRequestSchema = z.strictObject({
  remove_products: z.array(z.uuid()).max(500).optional(),
});
export type DeleteContractRequest = z.infer<typeof DeleteContractRequestSchema>;

export const DeleteResultSchema = z.object({
  deleted: z.literal(true),
  audit_id: z.string(),
  impact: z.object({
    milestones: z.number().int(),
    stock_reversed: z.number().int(),
    service_customers: z.number().int(),
    products: z.number().int(),
    partner_events_voided: z.number().int(),
    appendices: z.number().int(),
  }),
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;
