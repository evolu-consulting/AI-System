// CR-114 hub-fast-sdk · trần TỐC ĐỘ token/phút theo tenant (khác trần token/ngày `ai_reserve_tokens`): bucket Redis, MỘT
// script Lua nguyên tử mỗi lời gọi (đọc → nạp lại theo đồng hồ `TIME` của Redis → trừ), nên N lời gọi đồng thời từ nhiều
// instance không cấp quá dung lượng. Dung lượng = token/phút (nạp đều). Lời gọi lớn hơn dung lượng ⇒ tính bằng dung lượng
// (không chết đói mãi). Redis lỗi ⇒ CHO QUA + log `ai-rate-bucket-fail-open` (trần ngày ở Postgres vẫn giữ — không nới).
// `AI_TENANT_TOKENS_PER_MIN` (mặc định 2.000.000; `0` ⇒ tắt bucket).
import type { Redis } from "../redis";

export const AI_TENANT_TOKENS_PER_MIN = 2_000_000;
/** Khoá TTL (ms): bucket đầy lại sau 1 phút ⇒ giữ 2 phút là đủ. */
const KEY_TTL_MS = 120_000;

export type BucketTake = { ok: true } | { ok: false; retryMs: number };
export type TokenBucket = { take(tenantId: string, tokens: number): Promise<BucketTake> };
type Log = { warn(msg: string, f?: Record<string, unknown>): void };

// KEYS[1] = bucket; ARGV = cap, tokens, ttl_ms. Trả {1, 0} cấp | {0, retry_ms}.
const LUA = `
local cap = tonumber(ARGV[1])
local want = math.min(tonumber(ARGV[2]), cap)
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local h = redis.call('HMGET', KEYS[1], 'v', 't')
local v = tonumber(h[1])
local last = tonumber(h[2])
if v == nil then v = cap; last = now end
local rate = cap / 60000
v = math.min(cap, v + math.max(0, now - last) * rate)
if v >= want then
  redis.call('HSET', KEYS[1], 'v', tostring(v - want), 't', tostring(now))
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
  return {1, 0}
end
redis.call('HSET', KEYS[1], 'v', tostring(v), 't', tostring(now))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return {0, math.ceil((want - v) / rate)}
`;

export const bucketKey = (tenantId: string): string => `ai:tb:${tenantId}`;

export function envTokensPerMin(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env.AI_TENANT_TOKENS_PER_MIN;
  if (raw === undefined || raw === "") return AI_TENANT_TOKENS_PER_MIN;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return AI_TENANT_TOKENS_PER_MIN;
  return n === 0 ? null : n;
}

export function redisTokenBucket(
  redis: Redis,
  o: { tokensPerMin: (tenantId: string) => number | null; log?: Log },
): TokenBucket {
  return {
    async take(tenantId, tokens) {
      const cap = o.tokensPerMin(tenantId);
      if (cap === null || tokens <= 0) return { ok: true };
      try {
        const r = (await redis.eval(
          LUA,
          1,
          bucketKey(tenantId),
          cap,
          Math.ceil(tokens),
          KEY_TTL_MS,
        )) as [number, number];
        return r[0] === 1 ? { ok: true } : { ok: false, retryMs: Math.max(1, Number(r[1])) };
      } catch (err) {
        o.log?.warn("ai-rate-bucket-fail-open", {
          tenant_id: tenantId,
          error_name: (err as Error)?.name,
        });
        return { ok: true };
      }
    },
  };
}
