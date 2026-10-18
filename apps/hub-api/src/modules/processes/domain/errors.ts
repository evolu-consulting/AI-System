// HUB-FR-143…145 · CONVENTIONS §5 · plan-domain §3: lỗi domain = union chuỗi + `DomainError`. Kết quả nghiệp vụ bình
// thường trả giá trị, không ném. Adapter map mã ⇒ mã contract + HTTP (`DOMAIN_ERROR_MAP`, `adapters/processes.mapper.ts`).
export type ProcessDomainError =
  | "TIMER_STATE"
  | "RUN_STATE"
  | "NO_OUTPUT"
  | "REF_INVALID"
  | "DEF_INVALID"
  /** T6c · `tenantId` vào UoW không phải uuid (chặn trước khi mở tx). */
  | "TENANT_INVALID";

export class DomainError extends Error {
  constructor(
    readonly code: ProcessDomainError,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "DomainError";
  }
}
