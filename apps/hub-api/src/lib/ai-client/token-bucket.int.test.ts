// CR-114 hub-fast-sdk · Redis thật: bucket token/phút theo tenant (Lua nguyên tử) — N lời gọi đồng thời KHÔNG BAO GIỜ được cấp
// quá dung lượng; Redis lỗi ⇒ cho qua (fail-open) kèm log.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createRedis, type Redis } from "../redis";
import { redisTokenBucket } from "./token-bucket";

// Như `REDIS_TEST_URL` của fixtures H1 (không import để không cần env DB).
const REDIS_TEST_URL = process.env.HUB_TEST_REDIS_URL ?? "redis://localhost:6379/15";
let redis: Redis;
beforeAll(async () => {
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
});
afterAll(() => redis.disconnect());

describe("CR-114 · token bucket", () => {
  it("token bucket never over-admits under concurrency", async () => {
    const tenant = crypto.randomUUID();
    // 6000 token/phút = 0,1 token/ms ⇒ trong vài chục ms nạp lại không đáng kể (≤ vài chục token).
    const b = redisTokenBucket(redis, { tokensPerMin: () => 6000 });
    const tries = Array.from({ length: 200 }, () => b.take(tenant, 100));
    const t0 = performance.now();
    const got = await Promise.all(tries);
    const ms = performance.now() - t0;
    const admitted = got.filter((g) => g.ok).length * 100;
    const refill = Math.ceil((ms * 6000) / 60_000);
    expect(admitted).toBeGreaterThanOrEqual(6000 - 100);
    expect(admitted).toBeLessThanOrEqual(6000 + refill);
    const denied = got.find((g) => !g.ok);
    expect(denied && !denied.ok ? denied.retryMs : 0).toBeGreaterThan(0);
    await redis.del(`ai:tb:${tenant}`);
  });

  it("token bucket tenants are isolated", async () => {
    const [a, c] = [crypto.randomUUID(), crypto.randomUUID()];
    const b = redisTokenBucket(redis, { tokensPerMin: () => 1000 });
    expect((await b.take(a, 1000)).ok).toBe(true);
    expect((await b.take(a, 500)).ok).toBe(false);
    expect((await b.take(c, 1000)).ok).toBe(true);
    await redis.del(`ai:tb:${a}`, `ai:tb:${c}`);
  });

  it("token bucket fails open when Redis is down", async () => {
    const dead = createRedis("redis://127.0.0.1:1"); // không connect ⇒ enableOfflineQueue=false ném ngay
    const warns: string[] = [];
    const b = redisTokenBucket(dead, {
      tokensPerMin: () => 10,
      log: { warn: (m) => warns.push(m) },
    });
    expect((await b.take(crypto.randomUUID(), 1_000_000)).ok).toBe(true);
    expect(warns).toEqual(["ai-rate-bucket-fail-open"]);
    dead.disconnect();
  });
});
