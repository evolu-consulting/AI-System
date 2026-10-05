// HUB-FR-89 · mã lỗi/lý do/trạng thái job (plan H1 §2.5). `HUB_JOB_ERROR_CODES` ⊂ `CHAT_RUN_ERROR_CODES`.
import { z } from "zod";

export const HUB_JOB_ERROR_CODES = [
  "ALL_PROVIDERS_EXHAUSTED",
  "TIMEOUT",
  "CANCELLED",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
  "NOT_CONFIGURED",
] as const;
export const HubJobErrorCodeSchema = z.enum(HUB_JOB_ERROR_CODES);
export type HubJobErrorCode = z.infer<typeof HubJobErrorCodeSchema>;

export const JOB_FAIL_REASONS = [
  "quota",
  "tenant_slots",
  "provider_busy",
  "provider_unavailable",
  "orphaned",
  "crash",
  "cancelled",
  "timeout",
  "invalid_payload",
  "invalid_output",
  "sandbox",
  "credential",
  "upstream",
  // H2b F4 (R27): model/CLI từ chối — Hub chọn `hint` riêng, mã `run.failed` giữ như H1.
  "refused",
  // H2c R19: tải file đính kèm thất bại (hết lượt thử/sha256 lệch/vượt kích thước).
  "attachment",
] as const;
export const JobFailReasonSchema = z.enum(JOB_FAIL_REASONS);
export type JobFailReason = z.infer<typeof JobFailReasonSchema>;

/** orphaned = `failed` + `reason=orphaned`, không phải trạng thái riêng. */
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;
