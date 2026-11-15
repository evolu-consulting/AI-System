// CR-157: nhập tay là dự phòng khi AI đọc lỗi/hết giờ — nhập ngay trên HĐ đó; người nhập tích "đã đối chiếu với tệp gốc" trước Lưu/Gửi duyệt.
import { z } from "zod";

export const ENTRY_SOURCES = ["ai", "manual"] as const;
export const EntrySourceSchema = z.enum(ENTRY_SOURCES);
export type EntrySource = z.infer<typeof EntrySourceSchema>;

/** `POST /contracts/:id/manual-entry` (HĐ DRAFT + `extract_state = failed`) và `PUT /contracts/:id/reconcile` (HĐ manual, DRAFT). */
export const MANUAL_ENTRY_ERRORS = {
  /** HĐ không ở DRAFT, hoặc AI chưa lỗi (chỉ nhập tay khi đọc lỗi/hết giờ). */
  MANUAL_NOT_ALLOWED: 409,
  /** `reconcile` trên HĐ không phải nhập tay. */
  NOT_MANUAL: 409,
  /** CR-157b · thay tệp: chỉ HĐ DRAFT + AI đọc lỗi. */
  REPLACE_NOT_ALLOWED: 409,
} as const;
export type ManualEntryErrorCode = keyof typeof MANUAL_ENTRY_ERRORS;

export const ManualEntryRequestSchema = z.strictObject({});
export const ManualEntryResponseSchema = z.strictObject({
  id: z.uuid(),
  status: z.literal("draft"),
  extract_state: z.literal("ready"),
  entry_source: z.literal("manual"),
  version: z.number().int().min(1),
});
export type ManualEntryResponse = z.infer<typeof ManualEntryResponseSchema>;

/** `reconciled = true` ⇒ ghi người gọi + lúc này; `false` ⇒ bỏ xác nhận. Không đổi `version` (form đang mở không bị 409). */
export const ReconcileRequestSchema = z.strictObject({ reconciled: z.boolean() });
export const ReconcileResponseSchema = z.strictObject({
  id: z.uuid(),
  reconciled_by: z.uuid().nullable(),
  reconciled_at: z.string().nullable(),
});
export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>;
