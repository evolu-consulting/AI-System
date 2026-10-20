// TD #239 · thu hồi grant chat = compare-and-delete NGUYÊN TỬ (Lua) trên Redis thật: chỉ xoá khi grant còn là của run đó;
// run cũ thu hồi muộn / hai thu hồi đồng thời không xoá grant của run khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { REDIS_TEST_URL } from "../../../../../tests/acceptance/H1/_fixtures";
import { createRedis, type Redis } from "../../lib/redis";
import { ChatToolTokens, redisChatTokenStore } from "./chat-token";

let redis: Redis;
const packs = {
  info: (k: string) =>
    k === "contracts-search"
      ? { key: k, name: k, description: k, params: [], sideEffect: false, action: "read" as const }
      : undefined,
};
const KEYS = ["contracts-search"];
const bind = () => ({
  tenantId: crypto.randomUUID(),
  userId: "u",
  conversationId: crypto.randomUUID(),
  agentId: "a",
});

beforeAll(async () => {
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
});
afterAll(() => redis.disconnect());

describe("TD #239 · revoke grant nguyên tử (Redis thật)", () => {
  it("revoke xoá đúng grant của run; revoke muộn của run cũ không xoá grant run mới", async () => {
    const t = new ChatToolTokens({ store: redisChatTokenStore(redis), packs });
    const b = bind();
    const h = await t.newHandle(b);
    const g1 = await t.grant({ ...b, runId: "r1" }, KEYS, 60);
    const g2 = await t.grant({ ...b, runId: "r2" }, KEYS, 60); // ghi đè grant r1
    await g1?.revoke();
    expect((await t.resolve(h))?.runId).toBe("r2");
    await g2?.revoke();
    expect(await t.resolve(h)).toBeNull();
    await g2?.revoke(); // thu hồi lần hai: không lỗi, không gì để xoá
  });

  it("nhiều revoke đồng thời: grant của run khác sống sót, grant của chính run bị xoá đúng một lần", async () => {
    const store = redisChatTokenStore(redis);
    const t = new ChatToolTokens({ store, packs });
    for (let i = 0; i < 20; i++) {
      const b = bind();
      const h = await t.newHandle(b);
      const g1 = await t.grant({ ...b, runId: "r1" }, KEYS, 60);
      const g2 = await t.grant({ ...b, runId: "r2" }, KEYS, 60);
      await Promise.all([g1?.revoke(), g1?.revoke(), g1?.revoke()]);
      expect((await t.resolve(h))?.runId).toBe("r2");
      await Promise.all([g2?.revoke(), g2?.revoke()]);
      expect(await t.resolve(h)).toBeNull();
    }
  });

  it("delIfRun: không có key ⇒ false; JSON hỏng ⇒ giữ nguyên", async () => {
    const store = redisChatTokenStore(redis);
    const key = `mcp:chat-grant:test-${crypto.randomUUID()}`;
    expect(await store.delIfRun(key, "r1")).toBe(false);
    await store.set(key, "{not json", 60);
    expect(await store.delIfRun(key, "r1")).toBe(false);
    expect(await store.get(key)).toBe("{not json");
    await store.del(key);
  });
});
