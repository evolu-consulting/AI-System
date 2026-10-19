// L1 (TECH-DEBT #224) · bộ đếm giới hạn đăng nhập trên Redis: mỗi bước là MỘT script Lua (nguyên tử, một round trip).
// Giờ (`now`, ms) do app truyền vào (đồng hồ giả của test dùng được); TTL Redis chỉ để dọn khoá. Lỗi Redis ⇒ ném
// (limit.service đổi thành 503 AUTH_UNAVAILABLE — đóng an toàn). Luật gốc: limit.rules.ts (test unit đối chiếu).
import type { Redis } from "ioredis";
import { DEFAULT_LIMIT_POLICY, ipWindow, type LimitPolicy } from "./limit.rules";

export type PreCheck =
  | { kind: "ok" }
  | { kind: "ip_limited"; resetAt: number }
  | { kind: "locked"; until: number };

/** Cổng giới hạn đăng nhập (auth.service, totp, users.unlock dùng; test thay bằng bản giả nếu cần). */
export type LoginLimiter = {
  readonly policy: LimitPolicy;
  /** +1 lượt của IP; có `account` thì kiểm luôn khoá tài khoản. */
  pre(ip: string, account: string | null, now: number): Promise<PreCheck>;
  /** Một lần sai; trả `until` (ms) khi lần này VỪA khoá tài khoản, không thì null. */
  fail(account: string, now: number): Promise<number | null>;
  /** Đăng nhập đúng mật khẩu: xoá bộ đếm (cả bậc backoff). */
  success(account: string): Promise<void>;
  /** Admin gỡ khoá: xoá bộ đếm; true khi đang có khoá còn hiệu lực. */
  clear(account: string, now: number): Promise<boolean>;
};

const PRE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
if n > tonumber(ARGV[2]) then return {1, 0} end
if ARGV[4] == '1' then
  local u = tonumber(redis.call('HGET', KEYS[2], 'u') or '0')
  if u > tonumber(ARGV[1]) then return {2, string.format('%.0f', u)} end
end
return {0, 0}`;

const FAIL = `
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
redis.call('DEL', KEYS[1])
if u > tonumber(ARGV[1]) then return 1 end
return 0`;

export function redisLoginLimiter(
  redis: Redis,
  o: { prefix?: string; policy?: LimitPolicy } = {},
): LoginLimiter {
  const p = o.policy ?? DEFAULT_LIMIT_POLICY;
  const prefix = o.prefix ?? "rl:auth:";
  const acctKey = (a: string) => `${prefix}a:${a}`;
  const acctTtl = String(p.strikeResetMs + p.accountLockMaxMs);
  return {
    policy: p,
    async pre(ip, account, now) {
      const w = ipWindow(now, p);
      const ipKey = `${prefix}ip:${ip}:${w.slot}`;
      const args = [now, p.ipMaxAttempts, p.ipWindowMs * 2, account ? "1" : "0"];
      const keys = [ipKey, acctKey(account ?? "-")];
      const [kind, until] = (await redis.eval(PRE, 2, ...keys, ...args)) as [number, string];
      if (kind === 1) return { kind: "ip_limited", resetAt: w.resetAt };
      if (kind === 2) return { kind: "locked", until: Number(until) };
      return { kind: "ok" };
    },
    async fail(account, now) {
      const args = [now, p.accountMaxFails, p.accountLockBaseMs, p.accountLockMaxMs];
      const out = await redis.eval(FAIL, 1, acctKey(account), ...args, p.strikeResetMs, acctTtl);
      const until = Number(out);
      return until > 0 ? until : null;
    },
    async success(account) {
      await redis.del(acctKey(account));
    },
    async clear(account, now) {
      return (await redis.eval(CLEAR, 1, acctKey(account), now)) === 1;
    },
  };
}
