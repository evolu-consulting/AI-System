// L1 (TECH-DEBT #224) · ADM-FR-07 · luật giới hạn đăng nhập dạng hàm thuần (không I/O; giờ truyền vào).
// Theo tài khoản: khoá theo (tenant_key, username) đã chuẩn hoá — CẢ tài khoản không tồn tại, để 423 không lộ tài khoản có thật.
// Theo IP: cửa sổ cố định. Bản Lua trong limit.redis.ts làm đúng các luật này một cách nguyên tử; test unit giữ hai bên khớp.
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

/**
 * T1: chính sách theo env. `LOGIN_IP_MAX_ATTEMPTS` chỉ cho dev/test (e2e chạy song song nhiều app từ một IP 127.0.0.1,
 * dùng chung một Redis ⇒ trần 30/10' của cả lượt chặn đăng nhập); production đặt biến này ⇒ lỗi (không nới trần IP).
 */
export function policyFromEnv(appEnv: string, ipMaxAttempts: number | undefined): LimitPolicy {
  if (ipMaxAttempts === undefined) return DEFAULT_LIMIT_POLICY;
  if (appEnv === "production")
    throw new Error("LOGIN_IP_MAX_ATTEMPTS chỉ dùng cho dev/test, không đặt ở production");
  return { ...DEFAULT_LIMIT_POLICY, ipMaxAttempts };
}

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

/** Cổng băm (L1c, review C: rules thuần, không import crypto) — adapter `limit.keys.ts` nối SHA-256. */
export type Hasher = (input: string) => string;

/** Khoá tài khoản: băm(tenant_key + NUL + username đã chuẩn hoá) — không đưa tên người dùng thô vào Redis. */
export function accountIdWith(hash: Hasher, tenantKey: string, username: string): string {
  return hash(`${tenantKey}\u0000${username}`);
}

const HEXTET = /^[0-9a-f]{1,4}$/;

/** IPv6 thuần ⇒ tiền tố /64 ("2001:db8:0:1::/64"); IPv4-mapped / hỏng ⇒ null. */
function v6Prefix64(s: string): string | null {
  if (!s.includes(":") || s.includes(".")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = 8 - head.length - tail.length;
  if (gap < 0 || (halves.length === 1 && gap !== 0)) return null;
  const all = [...head, ...Array<string>(gap).fill("0"), ...tail];
  if (!all.every((h) => HEXTET.test(h))) return null;
  return `${all
    .slice(0, 4)
    .map((h) => h.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * IP rỗng/không đọc được dồn chung một xô (an toàn: vẫn bị giới hạn). Bỏ ký tự lạ, cắt 64. L1c (A-6): IPv6 gộp theo /64
 * — một máy thường có cả /64, xoay địa chỉ trong đó không né được trần IP.
 */
export function ipId(ip: string | null | undefined): string {
  const s = (ip ?? "").trim().toLowerCase();
  if (!/^[0-9a-f.:]{1,64}$/.test(s)) return "unknown";
  return v6Prefix64(s) ?? s;
}
