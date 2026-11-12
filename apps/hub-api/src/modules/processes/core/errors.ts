// HUB-FR-105 · D16 · lỗi khối mới `CHAT_PROCESS_ERRORS` (plan-contract §4): status lấy từ contract (một nguồn); không thêm
// vào `HubErrorCode` của `lib/errors.ts` (khối X2a/X2b khoá test) — `AppError` dùng chung nên `mapError` trả đúng body.
import {
  CHAT_CLAIM_ERRORS,
  CHAT_PROCESS_ERRORS,
  CHAT_PROCESS_N2_ERRORS,
  type ChatClaimErrorCode,
  type ChatProcessErrorCode,
  type ChatProcessN2ErrorCode,
} from "@ai/contracts/chat";
import { AppError } from "../../../lib/errors";

/** Message tiếng Anh cố định; client dịch theo `code`. */
const MESSAGES: Record<ChatProcessErrorCode, string> = {
  PROCESS_NOT_FOUND: "Process not found",
  PROCESS_THREAD_NO_AGENT: "Agents cannot be tagged in a process thread",
  TOO_MANY_PROCESS_RUNS: "Too many running processes",
  FEEDBACK_REQUIRED: "Feedback is required",
  FORWARD_TARGET_INVALID: "Invalid forward target",
  REVIEW_TASK_CLOSED: "Task is already closed",
  TASK_KIND_MISMATCH: "Action does not match the task",
  PROCESS_RUN_STATE: "Process run is not in a state that allows this",
  NO_OUTPUT: "Stage has no output yet",
  FORWARD_LIMIT: "Forward limit reached",
  FORWARD_OUT_OF_GROUP: "Recipient is not in the review group",
  NOT_PROCESS_DECIDER: "Only the starter or an admin can do this",
  BACK_TARGET_INVALID: "Invalid step to go back to",
};

/** N2 · khối lỗi riêng (`CHAT_PROCESS_N2_ERRORS`, không đụng khối P-a đã khoá test). */
const N2_MESSAGES: Record<ChatProcessN2ErrorCode, string> = {
  STARTER_CANNOT_REVIEW: "The run starter cannot review this stage",
  PROCESS_ENGINE_OFF: "Process engine is not enabled",
};
export function processN2Error(code: ChatProcessN2ErrorCode): AppError {
  return new AppError(code, CHAT_PROCESS_N2_ERRORS[code], N2_MESSAGES[code]);
}

export function processError(
  code: ChatProcessErrorCode,
  details?: unknown,
  headers?: Readonly<Record<string, string>>,
): AppError {
  const err = new AppError(code, CHAT_PROCESS_ERRORS[code], MESSAGES[code], details);
  if (headers) err.headers = headers;
  return err;
}

/** CR-127 · E2 · khối lỗi nhận việc / bằng chứng / uỷ quyền (`CHAT_CLAIM_ERRORS`); câu VI ở client theo `code` (tasks.md §9). */
const CLAIM_MESSAGES: Record<ChatClaimErrorCode, string> = {
  EVIDENCE_REQUIRED: "Evidence is required",
  TASK_CLAIMED: "Someone else has taken this task",
  TASK_NOT_CLAIMABLE: "This task does not need to be taken",
  TASK_CLOSED: "Task is already closed",
  NOT_CLAIMER: "Only the person holding this task can do this",
  NOT_GROUP_HEAD: "Only the department head or a company admin can do this",
  TARGET_NOT_IN_GROUP: "The person is not in the task's group",
  FORWARD_REASON_REQUIRED: "A reason is required",
  DELEGATE_SELF: "Cannot delegate to yourself",
  DELEGATE_CHAIN: "Delegation chains are not allowed",
  DELEGATE_NOT_SIGNER: "The delegate is not a contract signer",
  DELEGATE_NO_ACCESS: "The delegate cannot access this work",
  DELEGATE_FORBIDDEN: "Not allowed to manage this delegation",
  FORBIDDEN_TENANT_ADMIN_WRITE: "Company admins cannot change this",
  TRIGGER_PARAM_RANGE: "Value is out of range",
  CLAIM_HOURS_RANGE: "Hours must be between 1 and 168",
  ESCALATE_TARGET_REQUIRED: "Escalation target is required",
};
export function claimError(code: ChatClaimErrorCode, details?: unknown): AppError {
  return new AppError(code, CHAT_CLAIM_ERRORS[code], CLAIM_MESSAGES[code], details);
}
