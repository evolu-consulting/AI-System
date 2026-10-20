// L1 (TECH-DEBT #224) · bộ đếm giới hạn đăng nhập trên Redis: mỗi bước là MỘT script Lua (nguyên tử, một round trip).
// Giờ (`now`, ms) do app truyền vào (đồng hồ giả của test dùng được); TTL Redis chỉ để dọn khoá. Lỗi Redis ⇒ ném
// (limit.service đổi thành 503 AUTH_UNAVAILABLE — đóng an toàn). Luật gốc: limit.rules.ts (test unit đối chiếu).
// L1c (review A-3): PRE giữ chỗ lượt đang chạy (zset `p:<acct>`, điểm = hạn giữ chỗ) — số lần sai đã ghi + số lượt đang
// verify không bao giờ vượt `accountMaxFails`, nên một đợt song song không đoán được quá 5 lần mỗi chu kỳ khoá. FAIL/SUCCESS/
// RELEASE nhả chỗ; tiến trình chết giữa chừng ⇒ chỗ tự hết hạn sau `reserveMs`.
import type { Redis } from "ioredis";
import { DEFAULT_LIMIT_POLICY, ipWindow, type LimitPolicy } from "./limit.rules";

export type PreCheck =
  | { kind: "ok" }
  | { kind: "ip_limited"; resetAt: number }
  | { kind: "locked"; until: number }
  /** Đã đủ lượt đang verify cho tài khoản này (A-3) — thử lại sau giây lát. */
  | { kind: "busy" };

/** Cổng giới hạn đăng nhập (auth.service, totp, users.unlock dùng; test thay bằng bản giả nếu cần). */
export type LoginLimiter = {
  readonly policy: LimitPolicy;
  /** +1 lượt của IP; có `account` thì kiểm khoá và giữ chỗ lượt `token` (nhả bằng fail/success/release). */
  pre(ip: string, account: string | null, now: number, token?: string): Promise<PreCheck>;
  /** Một lần sai (nhả chỗ `token`); trả `until` (ms) khi lần này VỪA khoá tài khoản, không thì null. */
  fail(account: string, now: number, token: string): Promise<number | null>;
  /** Đăng nhập đúng mật khẩu: xoá bộ đếm (cả bậc backoff) và nhả chỗ. */
  success(account: string, token: string): Promise<void>;
  /** Lượt kết thúc không qua verify (khoá DB, lỗi): chỉ nhả chỗ. */
  release(account: string, token: string): Promise<void>;
  /** Admin gỡ khoá: xoá bộ đếm; true khi đang có khoá còn hiệu lực. */
  clear(account: string, now: number): Promise<boolean>;
};

/** Hạn một chỗ giữ (ms, theo `now` của app): verify + hàng đợi semaphore xa dưới mức này. */
export const RESERVE_MS = 30_000;

const PRE = `
local now = tonumber(ARGV[1])
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
if n > tonumber(ARGV[2]) then return {1, 0} end
if ARGV[4] == '1' then
  local u = tonumber(redis.call('HGET', KEYS[2], 'u') or '0')
  if u > now then return {2, string.format('%.0f', u)} end
  redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
  local f = tonumber(redis.call('HGET', KEYS[2], 'f') or '0')
  if f + redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) then return {3, 0} end
  redis.call('ZADD', KEYS[3], string.format('%.0f', now + tonumber(ARGV[7])), ARGV[6])
  redis.call('PEXPIRE', KEYS[3], ARGV[8])
end
return {0, 0}`;

const FAIL = `
redis.call('ZREM', KEYS[2], ARGV[7])
local h = redis.call('HMGET', KEYS[1], 'f', 's', 'u', 't')
local f, s = tonumber(h[1] or '0'), tonumber(h[2] or '0')
local u, t = tonumber(h[3] or '0'), tonumber(h[4] or '0')
local now = tonumber(ARGV[1])
if u > now then return '0' end
if s > 0 and now - t > tonumber(ARGV[5]) then s = 0 end
f = f + 1
if f < tonumber(ARGV[2]) then
  redis.call('HSET', KEYS[1], 'f', f, 's', s)
  redis.call('PEXPIRE', KEYS[1], ARGV[6])
  return '0'
end
s = s + 1
local d = tonumber(ARGV[3]) * (2 ^ (s - 1))
if d > tonumber(ARGV[4]) then d = tonumber(ARGV[4]) end
u = now + d
redis.call('HSET', KEYS[1], 'f', 0, 's', s, 'u', string.format('%.0f', u), 't', string.format('%.0f', now))
redis.call('PEXPIRE', KEYS[1], ARGV[6])
return string.format('%.0f', u)`;

const CLEAR = `
local u = tonumber(redis.call('HGET', KEYS[1], 'u') or '0')
redis.call('DEL', KEYS[1], KEYS[2])
if u > tonumber(ARGV[1]) then return 1 end
return 0`;

export function redisLoginLimiter(
  redis: Redis,
  o: { prefix?: string; policy?: LimitPolicy } = {},
): LoginLimiter {
  const p = o.policy ?? DEFAULT_LIMIT_POLICY;
  const prefix = o.prefix ?? "rl:auth:";
  const acctKey = (a: string) => `${prefix}a:${a}`;
  const pendKey = (a: string) => `${prefix}p:${a}`;
  const acctTtl = String(p.strikeResetMs + p.accountLockMaxMs);
  return {
    policy: p,
    async pre(ip, account, now, token) {
      const w = ipWindow(now, p);
      const ipKey = `${prefix}ip:${ip}:${w.slot}`;
      const a = account ?? "-";
      const args = [now, p.ipMaxAttempts, p.ipWindowMs * 2, account ? "1" : "0"];
      const more = [p.accountMaxFails, token ?? Bun.randomUUIDv7(), RESERVE_MS, RESERVE_MS * 2];
      const keys = [ipKey, acctKey(a), pendKey(a)];
      const out = (await redis.eval(PRE, 3, ...keys, ...args, ...more)) as [number, string];
      const [kind, until] = out;
      if (kind === 1) return { kind: "ip_limited", resetAt: w.resetAt };
      if (kind === 2) return { kind: "locked", until: Number(until) };
      if (kind === 3) return { kind: "busy" };
      return { kind: "ok" };
    },
    async fail(account, now, token) {
      const args = [now, p.accountMaxFails, p.accountLockBaseMs, p.accountLockMaxMs];
      const keys = [acctKey(account), pendKey(account)];
      const out = await redis.eval(FAIL, 2, ...keys, ...args, p.strikeResetMs, acctTtl, token);
      const until = Number(out);
      return until > 0 ? until : null;
    },
    async success(account, token) {
      const out = await redis.multi().del(acctKey(account)).zrem(pendKey(account), token).exec();
      if (!out) throw new Error("redis multi aborted");
      for (const [err] of out) if (err) throw err;
    },
    async release(account, token) {
      await redis.zrem(pendKey(account), token);
    },
    async clear(account, now) {
      return (await redis.eval(CLEAR, 2, acctKey(account), pendKey(account), now)) === 1;
    },
  };
}
