// HUB-FR-99 · luật thuần `/me/stream` + danh bạ (test-plan X2a §5.1 R20–R23; plan §7, §8 `me-stream.rules.ts`,
// `directory.rules.ts`).
import { describe, expect, it } from "bun:test";
import { loadDirectoryRules, loadMeStreamRules } from "../_modules";

describe("R20–R22 · me-stream.rules [X2a-AC08 · AC12]", () => {
  it("HUB-FR-99 · R20 · parseStreamId: `1-0`, `1696000000000-12` hợp lệ; abc, `1-`, 21 chữ số, rỗng, null, undefined ⇒ null [X2a-AC08]", async () => {
    const r = await loadMeStreamRules();
    expect(r.parseStreamId("1-0")).toBe("1-0");
    expect(r.parseStreamId("1696000000000-12")).toBe("1696000000000-12");
    for (const bad of ["abc", "1-", "-1", `${"9".repeat(21)}-0`, "1-0 ", "", null, undefined])
      expect(r.parseStreamId(bad)).toBeNull();
  });

  it("HUB-FR-99 · R21 · resumeDecision: null ⇒ tail; info null ⇒ reset; > lastGenerated ⇒ reset; < maxDeleted ⇒ reset; = maxDeleted / giữa ⇒ replay [X2a-AC08]", async () => {
    const r = await loadMeStreamRules();
    const info = { lastGenerated: "100-5", maxDeleted: "50-0" };
    expect(r.resumeDecision(null, info)).toBe("tail");
    expect(r.resumeDecision(null, null)).toBe("tail");
    expect(r.resumeDecision("60-0", null)).toBe("reset");
    expect(r.resumeDecision("100-6", info)).toBe("reset");
    expect(r.resumeDecision("101-0", info)).toBe("reset");
    expect(r.resumeDecision("49-9", info)).toBe("reset");
    expect(r.resumeDecision("50-0", info)).toBe("replay");
    expect(r.resumeDecision("75-3", info)).toBe("replay");
    expect(r.resumeDecision("100-5", info)).toBe("replay");
    // so sánh số, không so chuỗi: "9-0" < "50-0"
    expect(r.resumeDecision("9-0", info)).toBe("reset");
  });

  it("HUB-FR-99 · R22 · evictOldest: 6 kết nối, max 5 ⇒ bỏ cũ nhất (phần tử đầu); ≤ max ⇒ không bỏ [spec-isolation §1]", async () => {
    const r = await loadMeStreamRules();
    expect(r.evictOldest(["c1", "c2", "c3", "c4", "c5", "c6"], 5)).toEqual(["c1"]);
    expect(r.evictOldest(["c1", "c2", "c3"], 5)).toEqual([]);
    expect(r.evictOldest(["c1", "c2", "c3", "c4", "c5", "c6", "c7"], 5)).toEqual(["c1", "c2"]);
  });
});

describe("R23 · directory.rules [X2a-R22]", () => {
  it("HUB-FR-102 · R23 · likePattern thoát `\\ % _` và bọc `%…%` [X2a-AC10]", async () => {
    const r = await loadDirectoryRules();
    expect(r.likePattern("lan")).toBe("%lan%");
    expect(r.likePattern("50%")).toBe("%50\\%%");
    expect(r.likePattern("a_b")).toBe("%a\\_b%");
    expect(r.likePattern("c:\\x")).toBe("%c:\\\\x%");
  });
});
