// CR-097 K1 · HD-FR-100 khoá cứng sau xác nhận · HD-FR-104 owner mở lại có lý do (log `contract_events` type `reopened`) ·
// decision 1 chặn tạo HĐ nhập tay mới. Mã lỗi riêng (không đụng `CONTRACT_ERRORS` của lát khác).
import { z } from "zod";
import { VersionSchema } from "../common";
import { ContractStatusSchema, nfcText } from "./fields";

export const LOCK_ERRORS = {
  /** HĐ đã xác nhận (khoá): trường pháp lý / tiền / bên / ngày chỉ đọc cho mọi người. */
  CONTRACT_LOCKED: 409,
  /** Mở lại HĐ chưa khoá. */
  CONTRACT_NOT_LOCKED: 409,
  /** Tạo HĐ nhập tay đã ngừng (HĐ phải có văn bản; nhập tay chuyển sang Giao dịch). */
  MANUAL_CONTRACT_DISABLED: 410,
  /** CR-101a: mở lại HĐ mà không phải người phụ trách cũng không phải owner gói. */
  REOPEN_FORBIDDEN: 403,
  /** CR-101a (Câu 5): ngừng tạo phụ lục mới — sửa đổi qua "Tải bản cập nhật" (phiên bản). */
  USE_VERSIONS: 410,
} as const;

export const REOPEN_REASON_MAX = 500;
/** `POST /pack/contracts/contracts/:id/reopen` — CR-101a: người phụ trách HĐ hoặc owner gói; lý do bắt buộc (trim, ≥ 1 ký tự). */
export const ReopenRequestSchema = z.strictObject({
  reason: nfcText(REOPEN_REASON_MAX).min(1),
});
export type ReopenRequest = z.infer<typeof ReopenRequestSchema>;
export const ReopenResponseSchema = z.strictObject({
  id: z.uuid(),
  status: ContractStatusSchema,
  version: VersionSchema,
  locked: z.literal(false),
});
export type ReopenResponse = z.infer<typeof ReopenResponseSchema>;
