// Rule thuan su kien job (arch-a7: la chung cho stream/usage/runner, khong import module).
import {
  HUB_CONTRACT_VERSION,
  type HubJobErrorCode,
  type JobFailReason,
  type RunEvent,
  type TokenUsage,
} from "@ai/contracts/hub";

export const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 };

export const isJobTerminal = (e: RunEvent): boolean =>
  e.type === "job.result" || e.type === "job.failed";

export const FAILED_STATUSES = ["failed", "cancelled", "timed_out"] as const;
export type FailedStatus = (typeof FAILED_STATUSES)[number];
/** Mã mặc định theo trạng thái khi `error_code` vắng/lạ. */
export const STATUS_CODE: Record<FailedStatus, HubJobErrorCode> = {
  failed: "INTERNAL_ERROR",
  cancelled: "CANCELLED",
  timed_out: "TIMEOUT",
};

/** Sự kiện Hub tự dựng (không có trong `run:<id>`): `seq` 1, `at` = bây giờ. */
export type JobFailedEvent = Extract<RunEvent, { type: "job.failed" }>;

export function syntheticFailed(
  jobId: string,
  f: {
    code: HubJobErrorCode;
    reason: JobFailReason | null;
    message: string;
    status?: FailedStatus;
  },
  now = new Date(),
): JobFailedEvent {
  return {
    v: HUB_CONTRACT_VERSION,
    job_id: jobId,
    seq: 1,
    at: now.toISOString(),
    type: "job.failed",
    status: f.status ?? "failed",
    code: f.code,
    reason: f.reason,
    message: f.message.slice(0, 500) || f.code,
    usage: ZERO_USAGE,
  };
}
