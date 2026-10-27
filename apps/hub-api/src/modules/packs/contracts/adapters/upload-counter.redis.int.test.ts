// tenant-quotas-fix · Redis thật: Admin "Đặt lại hôm nay" (SET 0 KEEPTTL) xen giữa lượt giữ (INCR) và lượt hoàn (DECR) ⇒ bộ
// đếm về 0, không âm, vẫn giữ TTL; hoàn bình thường vẫn trừ đúng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { dailyCounterKey } from "@ai/contracts";
import { REDIS_TEST_URL } from "../../../../../../../tests/acceptance/H1/_fixtures";
import { createRedis, type Redis } from "../../../../lib/redis";
import { QUOTA_TTL_S, redisUploadCounter } from "./upload-counter.redis";

let redis: Redis;
beforeAll(async () => {
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
});
afterAll(() => redis.disconnect());

const days = () => ({ tenant: "2026-10-27", global: `g-${crypto.randomUUID()}` });

describe("tenant-quotas-fix · hoàn lượt tải kẹp ≥ 0", () => {
  it("giữ → Admin đặt lại (SET 0 KEEPTTL) → hoàn ⇒ 0, TTL còn", async () => {
    const tid = crypto.randomUUID();
    const d = days();
    const c = redisUploadCounter(redis);
    await c.take(tid, d);
    await c.take(tid, d);
    const key = dailyCounterKey("uploads", tid, d.tenant);
    expect(await redis.get(key)).toBe("2");
    await redis.set(key, "0", "KEEPTTL"); // như admin-api `redisDailyCounter.reset`
    await c.refund(tid, d);
    expect(await redis.get(key)).toBe("0");
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(QUOTA_TTL_S);
    expect(await redis.get(`q:contracts:g:${d.global}`)).toBe("1"); // khoá toàn hệ thống vẫn trừ đúng
    await redis.del(key, `q:contracts:g:${d.global}`);
  });
});
