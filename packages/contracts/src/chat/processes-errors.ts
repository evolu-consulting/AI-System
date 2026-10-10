// HUB-FR-105…111 · CR-056 · mã lỗi API quy trình (plan-contract §4). Khối riêng — không thêm vào CHAT_API_ERRORS /
// CHAT_ROUTING_ERRORS / CHAT_ROOM_* (test khoá X2a/X2b/C1).
import { z } from "zod";
import { PROCESS_SUGGESTIONS_MAX, ProcessKeySchema } from "./processes";

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
} as const;
export type ChatProcessErrorCode = keyof typeof CHAT_PROCESS_ERRORS;
export const CHAT_PROCESS_ERROR_CODES = Object.keys(CHAT_PROCESS_ERRORS) as ChatProcessErrorCode[];
export const ChatProcessErrorCodeSchema = z.enum(
  CHAT_PROCESS_ERROR_CODES as [ChatProcessErrorCode, ...ChatProcessErrorCode[]],
);

/** `PROCESS_NOT_FOUND.details`: ≤ 3 key gần đúng (không phân biệt không có / tắt / không được chạy). */
export const ProcessNotFoundDetailsSchema = z.strictObject({
  suggestions: z.array(ProcessKeySchema).max(PROCESS_SUGGESTIONS_MAX),
});
export type ProcessNotFoundDetails = z.infer<typeof ProcessNotFoundDetailsSchema>;
