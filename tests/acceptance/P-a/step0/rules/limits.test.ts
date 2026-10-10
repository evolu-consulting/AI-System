// HUB-FR-115 · HUB-FR-116 · C1 · D9 · R-L01…R-L04 — `teamLimitHit`, `budgetHit`, `totalTokens` (core/limits.rules.ts, plan-contract §7).
import { describe, expect, it } from "bun:test";
import { fn, loadChat, loadCoreRules } from "../../_support/modules";

const L = async (name: string) => fn(await loadCoreRules("limits"), name);
const limitsDefault = async () => {
  const c = await loadChat();
  expect(c.TEAM_LIMITS_DEFAULT).toBeDefined();
  return c.TEAM_LIMITS_DEFAULT;
};

describe("R-L · giới hạn nhóm + ngân sách token [HUB-FR-115, 116]", () => {
  it("HUB-FR-115 · R-L01 · dưới ngưỡng ⇒ null; chạm ngưỡng calls/tokens/time (TEAM_LIMITS_DEFAULT)", async () => {
    const f = await L("teamLimitHit");
    const l = await limitsDefault();
    const s = { calls: 0, tokens: 0, activeMs: 0 };
    expect(f({ ...s, calls: 9 }, l)).toBeNull();
    expect(f({ ...s, calls: 10 }, l)).toBe("calls");
    expect(f({ ...s, tokens: 199_999 }, l)).toBeNull();
    expect(f({ ...s, tokens: 200_000 }, l)).toBe("tokens");
    expect(f({ ...s, activeMs: 599_999 }, l)).toBeNull();
    expect(f({ ...s, activeMs: 600_000 }, l)).toBe("time");
  });
  it("HUB-FR-115 · R-L02 · vượt cả 3 ⇒ `calls` (thứ tự calls → tokens → time)", async () => {
    const f = await L("teamLimitHit");
    expect(f({ calls: 11, tokens: 300_000, activeMs: 700_000 }, await limitsDefault())).toBe(
      "calls",
    );
  });
  it("HUB-FR-116 · R-L03 · budgetHit: null không giới hạn; < budget false; = budget true (C1)", async () => {
    const f = await L("budgetHit");
    expect(f(5e6, null)).toBe(false);
    expect(f(999, 1000)).toBe(false);
    expect(f(1000, 1000)).toBe(true);
  });
  it("HUB-FR-117 · R-L04 · totalTokens: cache null ⇒ in+out; cache có ⇒ in+out+cr+cw (D9)", async () => {
    const f = await L("totalTokens");
    expect(f({ input: 100, output: 20, cacheRead: null, cacheWrite: null })).toBe(120);
    expect(f({ input: 100, output: 20, cacheRead: 5, cacheWrite: 7 })).toBe(132);
  });
});
