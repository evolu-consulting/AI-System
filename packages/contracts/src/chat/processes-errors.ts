// HUB-FR-105…111 · CR-056 · mã lỗi API quy trình (plan-contract §4). Khối riêng — không thêm vào CHAT_API_ERRORS /
// CHAT_ROUTING_ERRORS / CHAT_ROOM_* (test khoá X2a/X2b/C1).
import { z } from "zod";
import { PROCESS_RUNS_PER_TENANT, PROCESS_SUGGESTIONS_MAX, ProcessKeySchema } from "./processes";

export const CHAT_PROCESS_ERRORS = {
  PROCESS_NOT_FOUND: 404,
  PROCESS_THREAD_NO_AGENT: 422,
  TOO_MANY_PROCESS_RUNS: 429,
  FEEDBACK_REQUIRED: 422,
  FORWARD_TARGET_INVALID: 422,
  REVIEW_TASK_CLOSED: 409,
  TASK_KIND_MISMATCH: 409,
  PROCESS_RUN_STATE: 409,
  NO_OUTPUT: 409,
  FORWARD_LIMIT: 409,
  FORWARD_OUT_OF_GROUP: 403,
  NOT_PROCESS_DECIDER: 403,
  /** P-b2 · `back_to_step` ∉ `after.back_to_steps` của stage (HUB-FR-118). */
  BACK_TARGET_INVALID: 422,
} as const;
export type ChatProcessErrorCode = keyof typeof CHAT_PROCESS_ERRORS;
/**
 * N2 · khối riêng (không thêm vào CHAT_PROCESS_ERRORS — test khoá P-a/P-b2 đếm đúng 13 mã). N2-FR-05: người bắt đầu quyết
 * task duyệt của stage exclude_starter; N2-D10: gói gọi PackRuns khi engine quy trình tắt.
 */
export const CHAT_PROCESS_N2_ERRORS = {
  STARTER_CANNOT_REVIEW: 403,
  PROCESS_ENGINE_OFF: 503,
} as const;
export type ChatProcessN2ErrorCode = keyof typeof CHAT_PROCESS_N2_ERRORS;

/**
 * CR-127 · E1 · khối riêng (không đụng khối khoá ở trên): nhận việc, bằng chứng, uỷ quyền, quyền soạn, tham số lịch.
 * HTTP theo spec §4 (409 sai trạng thái/đua · 422 thiếu/sai dữ liệu · 403 quyền); câu VI ở `tasks.md` §9.
 */
export const CHAT_CLAIM_ERRORS = {
  EVIDENCE_REQUIRED: 422,
  /** SEC 2026-11-12 · tệp/chữ ký bằng chứng không do người ghi tải lên (hub 0141 RAISE EK422 ⇒ `mapError`). */
  EVIDENCE_FILE_NOT_OWNED: 422,
  TASK_CLAIMED: 409,
  TASK_NOT_CLAIMABLE: 409,
  TASK_CLOSED: 409,
  NOT_CLAIMER: 403,
  NOT_GROUP_HEAD: 403,
  TARGET_NOT_IN_GROUP: 422,
  FORWARD_REASON_REQUIRED: 422,
  DELEGATE_SELF: 422,
  DELEGATE_CHAIN: 422,
  DELEGATE_NOT_SIGNER: 422,
  DELEGATE_NO_ACCESS: 422,
  DELEGATE_FORBIDDEN: 403,
  FORBIDDEN_TENANT_ADMIN_WRITE: 403,
  TRIGGER_PARAM_RANGE: 422,
  CLAIM_HOURS_RANGE: 422,
  ESCALATE_TARGET_REQUIRED: 422,
} as const;
export type ChatClaimErrorCode = keyof typeof CHAT_CLAIM_ERRORS;

/** N2-FR-04 · `TOO_MANY_PROCESS_RUNS.details` (429): trần thật của tenant (`admin.tenants.process_runs_max`). */
export const TooManyProcessRunsDetailsSchema = z.object({ max: z.number().int().min(1) });
/** Trần để hiện trong câu 429: `details.max` của server; thiếu/sai (server cũ, mock) ⇒ `fallback`. Thuần — FE dùng chung. */
export function processRunsMaxOf(
  details: unknown,
  fallback: number = PROCESS_RUNS_PER_TENANT,
): number {
  const p = TooManyProcessRunsDetailsSchema.safeParse(details);
  return p.success ? p.data.max : fallback;
}
export const CHAT_PROCESS_ERROR_CODES = Object.keys(CHAT_PROCESS_ERRORS) as ChatProcessErrorCode[];
export const ChatProcessErrorCodeSchema = z.enum(
  CHAT_PROCESS_ERROR_CODES as [ChatProcessErrorCode, ...ChatProcessErrorCode[]],
);

/** `PROCESS_NOT_FOUND.details`: ≤ 3 key gần đúng (không phân biệt không có / tắt / không được chạy). */
export const ProcessNotFoundDetailsSchema = z.strictObject({
  suggestions: z.array(ProcessKeySchema).max(PROCESS_SUGGESTIONS_MAX),
});
export type ProcessNotFoundDetails = z.infer<typeof ProcessNotFoundDetailsSchema>;
