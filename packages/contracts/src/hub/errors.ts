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
