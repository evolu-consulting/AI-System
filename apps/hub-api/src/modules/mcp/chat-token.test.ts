// M2-chat · token tool chat ngắn hạn (unit, kho bộ nhớ + đồng hồ giả): chỉ tool đọc, hết hạn/thu hồi ⇒ null, sai dạng ⇒ null.
import { describe, expect, it } from "bun:test";
import {
  CHAT_TOKEN_TTL_MAX_S,
  CHAT_TOKEN_TTL_MIN_S,
  type ChatTokenClaims,
  type ChatTokenStore,
  ChatToolTokens,
  chatTokenTtlS,
  isChatToken,
} from "./chat-token";

function memStore(): ChatTokenStore & { size: () => number } {
  const m = new Map<string, ChatTokenClaims>();
  return {
    put: async (h, c) => void m.set(h, c),
    get: async (h) => m.get(h) ?? null,
    del: async (h) => void m.delete(h),
    size: () => m.size,
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
const WHO = { tenantId: "t", userId: "u", runId: "r", conversationId: "c", agentId: "a" };

describe("M2-chat · token tool chat ngắn hạn", () => {
  it("chỉ cấp tool đọc không side_effect; không còn tool nào ⇒ không cấp", async () => {
    const store = memStore();
    const t = new ChatToolTokens({ store, packs });
    const tok = await t.issue(
      WHO,
      ["contracts-finalize", "contracts-search", "pkdemo-mark", "x-y"],
      60,
    );
    expect(tok && isChatToken(tok.token)).toBe(true);
    expect((await t.resolve(tok?.token ?? ""))?.tools).toEqual(["contracts-search"]);
    expect(await t.issue(WHO, ["contracts-finalize"], 60)).toBeNull();
    expect(store.size()).toBe(1);
  });

  it("hết hạn (exp) ⇒ null dù kho còn giữ; thu hồi ⇒ null; sai dạng ⇒ null", async () => {
    let now = 1_000_000;
    const t = new ChatToolTokens({ store: memStore(), packs, now: () => now });
    const tok = await t.issue(WHO, ["contracts-search"], 60);
    if (!tok) throw new Error("no token");
    expect((await t.resolve(tok.token))?.userId).toBe("u");
    now += 60_000;
    expect(await t.resolve(tok.token)).toBeNull();
    now -= 60_000;
    await tok.revoke();
    expect(await t.resolve(tok.token)).toBeNull();
    expect(await t.resolve("hct_short")).toBeNull();
    expect(await t.resolve(tok.token.slice(4))).toBeNull();
  });

  it("TTL kẹp [60 s, 15 phút]", () => {
    expect(chatTokenTtlS(5)).toBe(CHAT_TOKEN_TTL_MIN_S);
    expect(chatTokenTtlS(300)).toBe(300);
    expect(chatTokenTtlS(3600)).toBe(CHAT_TOKEN_TTL_MAX_S);
  });
});
