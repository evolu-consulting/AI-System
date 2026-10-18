// HUB-FR-143…146 · CA-R03 · plan-domain §2 + plan-addendum A6: hằng nghiệp vụ khai LẠI ở lớp 1 (domain không import
// contract). Giá trị = hằng contract `@ai/contracts/chat` — `adapters/processes.mapper.test.ts` + PD-C10 khẳng định.
export const STAGE_RETRY_MAX = 3;
/** Backoff giây theo lần thử lại thứ 1/2/3 (PD-R03). */
export const RETRY_BACKOFF_S = [30, 120, 480] as const;
export const REMIND_EVERY_H = { min: 4, max: 168 } as const;
export const REMIND_MAX = 10;
export const REMIND_AFTER_H = 24;
export const ESCALATE_AFTER_H = { min: 4, max: 2160 } as const;
export const PROCESS_TTL_DAYS = { min: 1, max: 365, default: 7 } as const;
export const WAIT_OFFSET_DAYS = { min: -365, max: 365 } as const;
export const WAIT_HORIZON_DAYS = 730;
export const WAIT_TIME_DEFAULT = "09:00";
export const TIMER_SWEEP_BATCH = 100;
/** A6 — luật dời vào domain (run-state, forward) cần trần cũ của contract. */
export const REDO_MAX = 3;
export const ASKS_MAX = 3;
export const FORWARD_CHAIN_MAX = 3;
