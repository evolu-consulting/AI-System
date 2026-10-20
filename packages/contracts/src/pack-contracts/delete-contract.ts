// V2-M · BA v2 HD-07 · 5.5e · 6a · C7: xoá hẳn một HĐ. `GET /contracts/:id/delete-preview` liệt kê tác động (hộp xác nhận),
// `DELETE /contracts/:id` xoá trong MỘT tx (chỉ vai quản lý `contracts-owner` = quyền `admin`). Không hoàn tác.
import { z } from "zod";

export const DELETE_CONTRACT_ERRORS = {
  /** HĐ còn phụ lục ⇒ xoá phụ lục trước. */
  CONTRACT_HAS_APPENDIX: 409,
  /** HĐ đã gắn lô/chứng thư CKS ⇒ không xoá (CKS chỉ thêm). */
  CONTRACT_HAS_CKS: 409,
  /** Đảo kho không được (hàng nhập từ HĐ này đã bán hết) ⇒ chặn, không xoá gì. */
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
  /** SP sinh từ HĐ này, chưa có giao dịch khác ⇒ xoá theo. */
  products: z.array(z.string()),
  partner_events: z.number().int(),
  appendices: z.number().int(),
  has_cks: z.boolean(),
});
export type DeleteImpact = z.infer<typeof DeleteImpactSchema>;

export const DeleteResultSchema = z.object({
  deleted: z.literal(true),
  audit_id: z.string(),
  impact: z.object({
    milestones: z.number().int(),
    stock_reversed: z.number().int(),
    service_customers: z.number().int(),
    products: z.number().int(),
    partner_events_voided: z.number().int(),
  }),
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;
