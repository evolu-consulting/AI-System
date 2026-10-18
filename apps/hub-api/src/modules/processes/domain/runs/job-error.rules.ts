// HUB-FR-143 · HUB-BR-41 · PD-R01/R02 · AC-H39 · AC-H40 · plan-domain §4.1 · plan-addendum A7 Q6: phân loại lỗi job
// stage ⇒ tạm (thử lại) / nghiệp vụ (quyết ngay). Thuần, lớp 1 (không import contract, KHÔNG đọc `provider_state`).

/** Lớp lỗi job: `transient` ⇒ có thể thử lại tự động; `business` ⇒ cần người quyết. */
export type JobErrorClass = "transient" | "business";

/** Lý do job (`hub.jobs.error_reason`) tạm thời — xét TRƯỚC mã (PD-R01 bước 1). */
export const TRANSIENT_JOB_REASONS: ReadonlySet<string> = new Set([
  "timeout",
  "upstream",
  "crash",
  "orphaned",
  "provider_busy",
  "tenant_slots",
]);

/** Mã lỗi job tạm thời — chỉ xét khi `reason` null (PD-R01 bước 2). */
export const TRANSIENT_JOB_CODES: ReadonlySet<string> = new Set(["TIMEOUT", "UPSTREAM_ERROR"]);

/**
 * PD-R01: `reason` ≠ null ⇒ tạm ⇔ `reason` ∈ 6 lý do tạm; `reason` null ⇒ tạm ⇔ `code` ∈ {TIMEOUT, UPSTREAM_ERROR};
 * còn lại (gồm mã/lý do lạ, chuỗi rỗng) ⇒ nghiệp vụ (PD-R02). `interrupted` KHÔNG qua hàm này (người gọi tự đặt tạm).
 */
export function classifyJobError(code: string | null, reason: string | null): JobErrorClass {
  if (reason !== null) return TRANSIENT_JOB_REASONS.has(reason) ? "transient" : "business";
  return code !== null && TRANSIENT_JOB_CODES.has(code) ? "transient" : "business";
}

/** Lý do needs_decision "cũ" (A3) khi không thử lại; A7 Q6: `interrupted` thắng TIMEOUT. */
export function legacyFailReason(f: {
  code: string | null;
  interrupted: boolean;
}): "job_timeout" | "agent_failed" | "interrupted" {
  if (f.interrupted) return "interrupted";
  return f.code === "TIMEOUT" ? "job_timeout" : "agent_failed";
}
