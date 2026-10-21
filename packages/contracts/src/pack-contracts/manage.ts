// gap-a1 · trang chi tiết HĐ: giao người phụ trách, sửa hoa hồng %, lịch sử thay đổi, tóm tắt bằng AI. Mã lỗi riêng của nhóm này
// (không nhét vào `CONTRACT_ERRORS` để không đụng lát khác).
import { z } from "zod";
import { IsoDateTime, VersionSchema } from "../common";
import { AiSummarySchema } from "./extract";

export const MANAGE_ERRORS = {
  /** Người được giao không phải thành viên đang dùng được của tenant có quyền xem gói hợp đồng. */
  OWNER_INVALID: 422,
  /** Hoa hồng chỉ cho HĐ Giới thiệu đã đọc xong. */
  COMMISSION_NOT_ALLOWED: 422,
  /** HĐ đã có tóm tắt AI / chưa có văn bản để tóm tắt. */
  SUMMARY_NOT_ALLOWED: 409,
  /** AI chưa cấu hình / trả đầu ra hỏng. */
  SUMMARY_UNAVAILABLE: 503,
} as const;

export const OwnerAssignRequestSchema = z.strictObject({ owner_user_id: z.uuid().nullable() });
export type OwnerAssignRequest = z.infer<typeof OwnerAssignRequestSchema>;
export const OwnerAssignResponseSchema = z.strictObject({
  id: z.uuid(),
  owner_user_id: z.uuid().nullable(),
});
export type OwnerAssignResponse = z.infer<typeof OwnerAssignResponseSchema>;

/** Người có thể được giao: thành viên tenant, còn dùng được, thuộc nhóm có quyền xem gói hợp đồng. */
export const AssigneesResponseSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.uuid(), name: z.string() })).max(500),
});
export type AssigneesResponse = z.infer<typeof AssigneesResponseSchema>;

export const COMMISSION_PCT_MAX = 100;
export const CommissionEditRequestSchema = z.strictObject({
  version: VersionSchema,
  commission_pct: z
    .number()
    .min(0)
    .max(COMMISSION_PCT_MAX)
    .refine((v) => Math.round(v * 100) === v * 100, "tối đa 2 chữ số thập phân")
    .nullable(),
});
export type CommissionEditRequest = z.infer<typeof CommissionEditRequestSchema>;
export const CommissionEditResponseSchema = z.strictObject({
  id: z.uuid(),
  version: VersionSchema,
  commission_pct: z.number().nullable(),
});
export type CommissionEditResponse = z.infer<typeof CommissionEditResponseSchema>;

export const HISTORY_MAX = 200;
export const HistoryItemSchema = z.strictObject({
  type: z.string(),
  actor_user_id: z.uuid().nullable(),
  at: IsoDateTime,
  data: z.unknown(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;
export const HistoryResponseSchema = z.strictObject({
  items: z.array(HistoryItemSchema).max(HISTORY_MAX),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

export const SummaryResponseSchema = z.strictObject({ id: z.uuid(), summary: AiSummarySchema });
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;
