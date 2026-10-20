// M2-chat · m2c · quyền tool chat (unit, kho bộ nhớ + đồng hồ giả): handle gắn hội thoại, grant theo run (chỉ tool đọc), handle
// không có grant ⇒ null, grant hết hạn/thu hồi ⇒ null, thu hồi chỉ xoá grant của đúng run, handle cũ chết khi cấp handle mới.
import { describe, expect, it } from "bun:test";
import {
  CHAT_TOKEN_TTL_MAX_S,
  CHAT_TOKEN_TTL_MIN_S,
  type ChatTokenStore,
  ChatToolTokens,
  chatTokenTtlS,
  isChatToken,
} from "./chat-token";

function memStore(): ChatTokenStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    expire: async (k) => m.has(k),
    del: async (k) => void m.delete(k),
  };
}
const INFO: Record<string, { sideEffect: boolean; action: "read" | "write" }> = {
  "contracts-search": { sideEffect: false, action: "read" },
  "contracts-finalize": { sideEffect: false, action: "write" },
  "pkdemo-mark": { sideEffect: true, action: "read" },
};
const packs = {
  info: (k: string) =>
    INFO[k] ? { key: k, name: k, description: k, params: [], ...INFO[k] } : undefined,
};
const B = { tenantId: "t", userId: "u", conversationId: "c", agentId: "a" };
const KEYS = ["contracts-finalize", "contracts-search", "pkdemo-mark", "x-y"];

describe("M2-chat · m2c · handle hội thoại + grant theo run", () => {
  it("grant chỉ tool đọc; handle chỉ dùng được khi có grant", async () => {
    const t = new ChatToolTokens({ store: memStore(), packs });
    const h = await t.newHandle(B);
    expect(isChatToken(h)).toBe(true);
    expect(await t.resolve(h)).toBeNull();
    const g = await t.grant({ ...B, runId: "r1" }, KEYS, 60);
    expect((await t.resolve(h))?.tools).toEqual(["contracts-search"]);
    expect((await t.resolve(h))?.runId).toBe("r1");
    expect(await t.grant({ ...B, runId: "r2" }, ["contracts-finalize"], 60)).toBeNull();
    await g?.revoke();
    expect(await t.resolve(h)).toBeNull();
  });

  it("A-5 · cùng handle qua 2 lượt (2 run): mỗi run có grant riêng, giữa hai lượt ⇒ null", async () => {
    const t = new ChatToolTokens({ store: memStore(), packs });
    const h = await t.newHandle(B);
    const g1 = await t.grant({ ...B, runId: "r1" }, KEYS, 60);
    expect((await t.resolve(h))?.runId).toBe("r1");
    await g1?.revoke();
    expect(await t.resolve(h)).toBeNull();
    expect(await t.refreshHandle(B)).toBe(true);
    const g2 = await t.grant({ ...B, runId: "r2" }, KEYS, 60);
    expect((await t.resolve(h))?.runId).toBe("r2");
    await g1?.revoke(); // thu hồi muộn của run cũ không xoá grant run mới
    expect((await t.resolve(h))?.runId).toBe("r2");
    await g2?.revoke();
  });

  it("grant hết hạn (exp) ⇒ null; handle mới làm handle cũ chết; hội thoại khác không dùng grant này", async () => {
    let now = 1_000_000;
    const t = new ChatToolTokens({ store: memStore(), packs, now: () => now });
    const h1 = await t.newHandle(B);
    await t.grant({ ...B, runId: "r1" }, KEYS, 60);
    now += 60_000;
    expect(await t.resolve(h1)).toBeNull();
    now -= 60_000;
    const h2 = await t.newHandle(B);
    expect(await t.resolve(h1)).toBeNull();
    expect((await t.resolve(h2))?.runId).toBe("r1");
    const other = await t.newHandle({ ...B, conversationId: "c2" });
    expect(await t.resolve(other)).toBeNull();
    expect(await t.resolve("hct_short")).toBeNull();
  });

  it("refreshHandle ⇒ false khi hội thoại chưa có handle", async () => {
    const t = new ChatToolTokens({ store: memStore(), packs });
    expect(await t.refreshHandle(B)).toBe(false);
  });

  it("TTL grant kẹp [60 s, 1 giờ]", () => {
    expect(chatTokenTtlS(5)).toBe(CHAT_TOKEN_TTL_MIN_S);
    expect(chatTokenTtlS(1200)).toBe(1200);
    expect(chatTokenTtlS(7200)).toBe(CHAT_TOKEN_TTL_MAX_S);
  });
});
