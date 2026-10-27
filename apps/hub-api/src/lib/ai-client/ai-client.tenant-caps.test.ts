// tenant-quotas · trần token AI: riêng của tenant thắng env; mốc đếm sau "Đặt lại hôm nay".
import { describe, expect, it } from "bun:test";
import { hubAiCaps } from "./ai-client.env";

const AT = new Date("2026-10-27T10:00:00Z");

describe("tenant-quotas · hubAiCaps", () => {
  it("tenant có giá trị riêng ⇒ dùng; không có ⇒ env", async () => {
    const caps = hubAiCaps(5_000_000, async (tid) =>
      tid === "a" ? { aiTokens: 42, aiTokensResetAt: null } : undefined,
    );
    expect(await caps.dailyTokens("a")).toBe(42);
    expect(await caps.dailyTokens("b")).toBe(5_000_000);
  });

  it("mốc đếm = lúc đặt lại hôm nay, không có ⇒ 00:00 UTC", async () => {
    const reset = new Date("2026-10-27T08:00:00Z");
    const caps = hubAiCaps(null, async () => ({ aiTokens: null, aiTokensResetAt: reset }));
    expect(await caps.since?.("a", AT)).toEqual(reset);
    expect(await hubAiCaps(null, async () => undefined).since?.("a", AT)).toEqual(
      new Date("2026-10-27T00:00:00Z"),
    );
    expect(hubAiCaps(7).since).toBeUndefined();
  });
});
