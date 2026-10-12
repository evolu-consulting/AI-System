// HUB-FR-105 · D16 · lỗi khối mới `CHAT_PROCESS_ERRORS` (plan-contract §4): status lấy từ contract (một nguồn); không thêm
// vào `HubErrorCode` của `lib/errors.ts` (khối X2a/X2b khoá test) — `AppError` dùng chung nên `mapError` trả đúng body.
import { CHAT_PROCESS_ERRORS, type ChatProcessErrorCode } from "@ai/contracts/chat";
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

export function processError(
  code: ChatProcessErrorCode,
  details?: unknown,
  headers?: Readonly<Record<string, string>>,
): AppError {
  const err = new AppError(code, CHAT_PROCESS_ERRORS[code], MESSAGES[code], details);
  if (headers) err.headers = headers;
  return err;
}
