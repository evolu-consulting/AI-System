// P-b · PF-S4 · PB-R17 · RF-28…33 (plan §3.4) · hàm thuần dùng chung launcher/stage-driver/team — không I/O, dễ test.
// Chỉ phần cần cho fix #133/#134 (mapTeamError). Các hàm nguồn còn lại (allowlistUnion/forceSourceTools/… RF-01…27) do
// PF-S1…S3 bổ sung; giữ file tối thiểu để không chặn S4.

/** 7 mã `runs_error_code_ck` (0000:297). */
export type RunErrorCode =
  | "ALL_PROVIDERS_EXHAUSTED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "CANCELLED"
  | "BUDGET_EXCEEDED"
  | "NOT_CONFIGURED"
  | "INTERNAL_ERROR";

/**
 * RF-28…33 · map reason lỗi team → 1 trong 7 mã `runs_error_code_ck` (PB-R17); KHÔNG bao giờ null.
 * `job_timeout`/`expired`⇒TIMEOUT · `not_configured`⇒NOT_CONFIGURED · `agent_failed`⇒UPSTREAM_ERROR · còn lại/null/undefined⇒INTERNAL_ERROR.
 */
export function mapTeamError(reason: string | null | undefined): RunErrorCode {
  switch (reason) {
    case "job_timeout":
    case "expired":
      return "TIMEOUT";
    case "not_configured":
      return "NOT_CONFIGURED";
    case "agent_failed":
      return "UPSTREAM_ERROR";
    default:
      return "INTERNAL_ERROR";
  }
}
