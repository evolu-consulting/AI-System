// CR-101 DOC-deals · R1, R5–R10, R37, R40 (API) · X1–X3 · Câu 1, 3, 4: Giao dịch = chứng từ `doc_type = 'deal'` (file tuỳ chọn, có
// nguồn). Lưu là có hiệu lực, sửa trực tiếp qua `PATCH /contracts/:id` (máy ghi lịch sử `GET /contracts/:id/edit-log`), nâng thành HĐ
// `POST /contracts/:id/promote` (multipart: `file` ký + `number`) giữ id/mốc/kho/điểm và khoá ngay. `/transactions*` cũ: GET đọc lớp
// tương thích, ghi ⇒ 410 `USE_CONTRACTS`.
import { z } from "zod";
import { VersionSchema } from "../common";
import { ManualContractRequestSchema } from "./extract";
import { CONTRACT_TEXT_MAX, nfcText } from "./fields";
import { ContractDealSchema } from "./milestones";

export const DEAL_SOURCES = ["invoice", "verbal", "message", "quote", "other"] as const;
export const DealSourceSchema = z.enum(DEAL_SOURCES);
export type DealSource = z.infer<typeof DealSourceSchema>;

export const DEAL_ERRORS = {
  /** `/transactions*` ghi: bảng G1 chỉ đọc — dùng `/contracts` (giao dịch là chứng từ). */
  USE_CONTRACTS: 410,
  /** Thao tác chỉ cho giao dịch (vd nâng) trên chứng từ khác. */
  NOT_A_DEAL: 409,
  /** Nâng thành HĐ thiếu file ký / số HĐ. */
  PROMOTE_NEEDS_FILE: 422,
  PROMOTE_NEEDS_NUMBER: 422,
} as const;
export type DealErrorCode = keyof typeof DEAL_ERRORS;

const { direction: _d, deal: _deal, ...manual } = ManualContractRequestSchema.shape;

/**
 * `POST /pack/contracts/contracts/deals` — tạo giao dịch (JSON, không file). Trường như nhập tay (`ManualContractRequestSchema`)
 * + `deal` bắt buộc + `source`. `settled_now` (Câu 4, ô "Đã giao / đã thanh toán ngay"): xác nhận ngay các mốc mặc định khi lưu
 * (giao ⇒ kho chạy theo luật giao hàng; tiền ⇒ đã thu/trả). Hoa hồng chỉ cho Giới thiệu.
 */
export const DealCreateRequestSchema = z
  .strictObject({
    ...manual,
    deal: ContractDealSchema,
    source: DealSourceSchema,
    settled_now: z.boolean().optional(),
  })
  .refine(
    (b) => b.deal === "referral" || (b.commission_pct == null && b.commission_fixed == null),
    { message: "hoa hồng chỉ cho giao dịch Giới thiệu", path: ["commission_pct"] },
  )
  .refine((b) => !(b.commission_pct != null && b.commission_fixed != null), {
    message: "hoa hồng: % hoặc cố định",
    path: ["commission_fixed"],
  });
export type DealCreateRequest = z.infer<typeof DealCreateRequestSchema>;

export const DealCreateResponseSchema = z.strictObject({
  id: z.uuid(),
  doc_type: z.literal("deal"),
  status: z.literal("active"),
  version: VersionSchema,
  /** Mốc đã xác nhận ngay khi lưu (`settled_now`). */
  settled: z.array(z.uuid()),
  /** Giao dịch ĐÃ lưu nhưng xác nhận ngay dừng ở một mốc (vd vượt tồn khi công tắc tắt) ⇒ mã lỗi; mốc còn lại để mở. */
  settle_error: z.string().nullable(),
});
export type DealCreateResponse = z.infer<typeof DealCreateResponseSchema>;

/** Trường chữ của multipart `POST /contracts/:id/promote` (kèm `file` bắt buộc). */
export const PromoteFormSchema = z.strictObject({
  number: nfcText(CONTRACT_TEXT_MAX).min(1),
});
export type PromoteForm = z.infer<typeof PromoteFormSchema>;
export const PromoteResponseSchema = z.strictObject({
  id: z.uuid(),
  doc_type: z.literal("contract"),
  locked: z.literal(true),
  version: VersionSchema,
  file_id: z.uuid(),
});
export type PromoteResponse = z.infer<typeof PromoteResponseSchema>;

export const EDIT_LOG_MAX = 500;
export const EditLogEntrySchema = z.strictObject({
  id: z.string(),
  at: z.string(),
  actor_user_id: z.uuid().nullable(),
  /** `fields.<khoá>` hoặc cột chứng từ (`title`, `source`, `doc_type`, `file_id`, …). */
  field: z.string(),
  old_value: z.unknown(),
  new_value: z.unknown(),
});
export type EditLogEntry = z.infer<typeof EditLogEntrySchema>;
/** `GET /contracts/:id/edit-log` — mới nhất trước, tối đa `EDIT_LOG_MAX`. */
export const EditLogResponseSchema = z.strictObject({
  items: z.array(EditLogEntrySchema).max(EDIT_LOG_MAX),
});
export type EditLogResponse = z.infer<typeof EditLogResponseSchema>;
