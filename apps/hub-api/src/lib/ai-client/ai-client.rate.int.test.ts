// CR-114 hub-fast-sdk · Redis thật: AI client của đường CŨ (`createHubAiClient` — contracts/knowledge dựng bằng hàm này, kèm
// `redis` của Hub) bị chặn khi tenant hết bucket token/phút: lời gọi bị chặn KHÔNG tới nhà cung cấp; tenant khác vẫn gọi được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "../db";
import { createRedis, type Redis } from "../redis";
import type { ModelProvider } from "./ai-client";
import { createHubAiClient } from "./ai-client.env";
import { bucketKey } from "./token-bucket";

const REDIS_TEST_URL = process.env.HUB_TEST_REDIS_URL ?? "redis://localhost:6379/15";
let redis: Redis;
beforeAll(async () => {
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
});
afterAll(() => redis.disconnect());

describe("CR-114 · AI client đường cũ + token bucket", () => {
  it("legacy createHubAiClient caller is blocked when tenant bucket is exhausted", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      key: "fake",
      complete: async (r) => {
        calls += 1;
        const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
        return { ok: true, text: "ok", model: r.model, usage };
      },
    };
    // Trần ngày tắt (0) ⇒ không SQL giữ chỗ; ghi usage lỗi (db giả) chỉ cảnh báo — chỉ bucket quyết định.
    const env = { AI_TENANT_DAILY_TOKENS: "0", AI_TENANT_TOKENS_PER_MIN: "1000" };
    const ai = createHubAiClient({ db: {} } as unknown as Db, { provider, env, redis });
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    const req = (tenantId: string) => ({
      tenantId,
      userId: null,
      feature: "contracts.extract",
      system: "s",
      prompt: "p",
      model: "m",
      maxTokens: 600,
      signal: new AbortController().signal,
    });
    expect((await ai.complete(req(a))).ok).toBe(true);
    expect(await ai.complete(req(a))).toEqual({ ok: false, code: "CAP_EXCEEDED" });
    expect(calls).toBe(1);
    expect((await ai.complete(req(b))).ok).toBe(true);
    expect(calls).toBe(2);
    await redis.del(bucketKey(a), bucketKey(b));
  });
});
