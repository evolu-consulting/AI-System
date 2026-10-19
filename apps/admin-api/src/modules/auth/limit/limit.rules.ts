// L1 (TECH-DEBT #224) · ADM-FR-07 · luật giới hạn đăng nhập dạng hàm thuần (không I/O; giờ truyền vào).
// Theo tài khoản: khoá theo (tenant_key, username) đã chuẩn hoá — CẢ tài khoản không tồn tại, để 423 không lộ tài khoản có thật.
// Theo IP: cửa sổ cố định. Bản Lua trong limit.redis.ts làm đúng các luật này một cách nguyên tử; test unit giữ hai bên khớp.
import { createHash } from "node:crypto";

export type LimitPolicy = {
  /** Số lần sai liên tiếp tới khi khoá (giống M1: lần 5 vẫn 401, lần 6 thấy 423). */
  accountMaxFails: number;
  /** Khoá lần đầu; lần khoá thứ n = base · 2^(n-1), trần `accountLockMaxMs`. */
  accountLockBaseMs: number;
  accountLockMaxMs: number;
  /** Không bị khoá thêm trong khoảng này ⇒ bậc backoff về 0. */
  strikeResetMs: number;
  ipMaxAttempts: number;
  ipWindowMs: number;
};

export const DEFAULT_LIMIT_POLICY: LimitPolicy = {
  accountMaxFails: 5,
  accountLockBaseMs: 15 * 60_000,
  accountLockMaxMs: 4 * 60 * 60_000,
  strikeResetMs: 24 * 60 * 60_000,
  ipMaxAttempts: 30,
  ipWindowMs: 10 * 60_000,
};

/** Thời hạn khoá cho lần khoá thứ `strike` (≥ 1): 15' → 30' → 1h → 2h → 4h (trần). */
export function lockDurationMs(strike: number, p: LimitPolicy = DEFAULT_LIMIT_POLICY): number {
  const n = Math.max(1, Math.floor(strike));
  return Math.min(p.accountLockBaseMs * 2 ** Math.min(n - 1, 30), p.accountLockMaxMs);
}

/** Trạng thái bộ đếm theo tài khoản (hash Redis: f, s, u, t). */
export type AccountState = {
  fails: number;
  strikes: number;
  lockedUntil: number;
  lastLockAt: number;
};
export const EMPTY_ACCOUNT: AccountState = { fails: 0, strikes: 0, lockedUntil: 0, lastLockAt: 0 };

export type FailOutcome = { state: AccountState; newLockUntil: number | null };

/** Một lần sai. Đang khoá ⇒ không đổi (như DB M1). Chạm trần ⇒ khoá mới, bậc +1, đếm về 0. */
export function afterAccountFail(
  s: AccountState,
  now: number,
  p: LimitPolicy = DEFAULT_LIMIT_POLICY,
): FailOutcome {
  if (s.lockedUntil > now) return { state: s, newLockUntil: null };
  const strikes = s.strikes > 0 && now - s.lastLockAt > p.strikeResetMs ? 0 : s.strikes;
  const fails = s.fails + 1;
  if (fails < p.accountMaxFails) {
    return { state: { ...s, fails, strikes }, newLockUntil: null };
  }
  const strike = strikes + 1;
  const until = now + lockDurationMs(strike, p);
  return {
    state: { fails: 0, strikes: strike, lockedUntil: until, lastLockAt: now },
    newLockUntil: until,
  };
}

export type IpWindow = { slot: number; resetAt: number };

/** Cửa sổ cố định chứa `now`: số thứ tự (vào khoá Redis) và lúc hết. */
export function ipWindow(now: number, p: LimitPolicy = DEFAULT_LIMIT_POLICY): IpWindow {
  const slot = Math.floor(now / p.ipWindowMs);
  return { slot, resetAt: (slot + 1) * p.ipWindowMs };
}

/** Giây chờ cho `Retry-After` (≥ 1, làm tròn lên). */
export function retryAfterS(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

/** Khoá tài khoản: SHA-256 của tenant_key + NUL + username (đã chuẩn hoá) — không đưa tên người dùng thô vào Redis. */
export function accountId(tenantKey: string, username: string): string {
  return createHash("sha256").update(`${tenantKey}\u0000${username}`).digest("hex");
}

/** IP rỗng/không đọc được dồn chung một xô (an toàn: vẫn bị giới hạn). Bỏ ký tự lạ, cắt 64. */
export function ipId(ip: string | null | undefined): string {
  const s = (ip ?? "").trim().toLowerCase();
  return /^[0-9a-f.:]{1,64}$/.test(s) ? s : "unknown";
}
