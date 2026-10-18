// HUB-FR-143 · P-d1 · ADR-0023: hằng nghiệp vụ khai lại ở domain web (không import @ai/contracts). Parity với contract
// được khẳng định ở `shared/lib/domain-contract.test.ts`. Bản sao thứ hai ở admin-web (CR-091, FD10).
export const STAGE_RETRY_MAX = 3;
export const REMIND_EVERY_H = { min: 4, max: 168 } as const;
export const ESCALATE_AFTER_H = { min: 4, max: 2160 } as const;
export const PROCESS_TTL_DAYS = { min: 1, max: 365, default: 7 } as const;
export const WAIT_OFFSET_DAYS = { min: -365, max: 365 } as const;
export const WAIT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
