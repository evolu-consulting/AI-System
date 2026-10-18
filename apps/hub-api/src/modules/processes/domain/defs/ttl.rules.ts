// HUB-FR-115 · PD-R24/R25 · ttl_days theo định nghĩa (thuần). Lớp 1: không contract.
const DAY_MS = 86_400_000;
const DEFAULT_TTL_DAYS = 7;

/** Tạo def: vắng ⇒ 7; `null` ⇒ không hết hạn. */
export function ttlOnCreate(v: number | null | undefined): number | null {
  return v === undefined ? DEFAULT_TTL_DAYS : v;
}

/** Sửa def: vắng ⇒ giữ giá trị hiện tại; `null` ⇒ không hết hạn. */
export function ttlOnUpdate(v: number | null | undefined, current: number | null): number | null {
  return v === undefined ? current : v;
}

/** Hạn run = `startedAt` + `ttlDays` ngày; `null` ⇒ không hết hạn. */
export function expiresAt(startedAt: Date, ttlDays: number | null): Date | null {
  return ttlDays === null ? null : new Date(startedAt.getTime() + ttlDays * DAY_MS);
}
