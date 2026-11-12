// CR-127 K3 · BR-02/03/04/36a · spec §3 (#3, #4, #8, #16), §4.1: Gửi / Gửi lại · Rút về · Tạo lại từ HĐ bị từ chối. Mã lỗi + HTTP: tasks §9.
import { z } from "zod";
import { EvidenceInputSchema } from "../chat/evidence";

export const SUBMIT_ERRORS = {
  CONTRACT_NOT_DRAFT: 409,
  EXTRACT_NOT_READY: 409,
  STATE_CONFLICT: 409,
  UNCHANGED_REASON_REQUIRED: 422,
  FILE_REQUIRED: 422,
  WITHDRAW_NOT_ALLOWED: 409,
  CONTRACT_NOT_REJECTED: 409,
  /** NF1 (người dùng chốt 2026-11-10): công ty chưa có quy trình duyệt khớp ⇒ CHẶN Gửi (không còn đi thẳng DONE); HĐ giữ DRAFT. */
  NO_APPROVAL_FLOW: 409,
} as const;
export type SubmitErrorCode = keyof typeof SUBMIT_ERRORS;

/** NF1 · lý do báo TRƯỚC vì sao không Gửi được (chi tiết HĐ `submit_block`): `no_flow` = công ty chưa có quy trình duyệt khớp. */
export const SUBMIT_BLOCKS = ["no_flow"] as const;
export type SubmitBlock = (typeof SUBMIT_BLOCKS)[number];

/** `POST /contracts/:id/submit` — gửi lần đầu hoặc Gửi lại (`submit_round > 0`, chạy lại quy trình từ bước đầu). */
export const SubmitRequestSchema = z.strictObject({
  unchanged_reason: z.string().trim().min(1).max(4000).optional(),
  evidence: EvidenceInputSchema.optional(),
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
export const SubmitResponseSchema = z.strictObject({
  status: z.enum(["processing", "done"]),
  no_flow: z.boolean(),
  round: z.number().int().min(1),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

export const WithdrawRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(4000) });
export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;
export const WITHDRAW_WHY = ["not_submitter", "step_decided", "not_processing"] as const;
export type WithdrawWhy = (typeof WITHDRAW_WHY)[number];
export const WithdrawResponseSchema = z.strictObject({ status: z.literal("draft") });

export const RecreateRequestSchema = z.strictObject({});
export const RecreateResponseSchema = z.strictObject({ id: z.uuid() });

/** CR-127 · M4 · loại bước trong "các bước HĐ sẽ đi qua": Duyệt · Ký số · Gửi đối tác · Thông báo · Xác nhận mốc · việc khác. */
export const SUBMIT_PREVIEW_KINDS = [
  "review",
  "esign",
  "partner_send",
  "notify",
  "milestone",
  "step",
] as const;
export type SubmitPreviewKind = (typeof SUBMIT_PREVIEW_KINDS)[number];
export const SubmitPreviewStepSchema = z.strictObject({
  kind: z.enum(SUBMIT_PREVIEW_KINDS),
  /** Tên bước (do quản trị đặt trong quy trình). */
  label: z.string(),
  /** Ai làm: tên người/phòng duyệt, hoặc "Tự động"/"Đối tác"/"Các bên ký"; chưa chọn người ⇒ câu cảnh báo. */
  who_label: z.string(),
  /** Hạn chuyển cấp (giờ) của bước Duyệt; vắng = không đặt. */
  due_h: z.number().int().positive().optional(),
});
export type SubmitPreviewStep = z.infer<typeof SubmitPreviewStepSchema>;
/** `GET /contracts/:id/submit-preview` — bước SẼ đi qua nếu Gửi ngay (theo dữ kiện hiện tại); `block:'no_flow'` ⇒ chưa có quy trình (Gửi bị chặn, NF1). */
export const SubmitPreviewResponseSchema = z.strictObject({
  flow_name: z.string().nullable(),
  steps: z.array(SubmitPreviewStepSchema),
  block: z.enum(SUBMIT_BLOCKS).optional(),
});
export type SubmitPreviewResponse = z.infer<typeof SubmitPreviewResponseSchema>;
