// tenant-quotas · ô hạn mức ngày: trống = mặc định, số nguyên dương, lỗi chặn lưu.
import { describe, expect, it } from "bun:test";
import { draftOf, parseLimit, sameDraft, toPut } from "./daily-limits-draft";

describe("tenant-quotas · daily-limits draft", () => {
  it("parseLimit: trống ⇒ null, '1.000' ⇒ 1000, 0/âm/chữ ⇒ invalid", () => {
    expect(parseLimit("uploads", " ")).toBeNull();
    expect(parseLimit("ai_tokens", "1.000")).toBe(1000);
    expect(parseLimit("uploads", "0")).toBe("invalid");
    expect(parseLimit("actions", "-3")).toBe("invalid");
    expect(parseLimit("uploads", "abc")).toBe("invalid");
  });

  it("toPut: đủ 3 khoá; còn ô lỗi ⇒ null", () => {
    expect(toPut({ uploads: "50", actions: "", ai_tokens: "2000000" })).toEqual({
      uploads: 50,
      actions: null,
      ai_tokens: 2_000_000,
    });
    expect(toPut({ uploads: "x", actions: "", ai_tokens: "" })).toBeNull();
  });

  it("draftOf/sameDraft: override null ⇒ ô trống", () => {
    const d = draftOf({
      tenant_id: "t",
      timezone: "UTC",
      items: [
        { kind: "uploads", override: 5, env_default: 30, effective: 5, used: 1, day: "2026-10-27" },
        {
          kind: "actions",
          override: null,
          env_default: 100,
          effective: 100,
          used: 0,
          day: "2026-10-27",
        },
      ],
    });
    expect(d).toEqual({ uploads: "5", actions: "", ai_tokens: "" });
    expect(sameDraft(d, { uploads: "5 ", actions: "", ai_tokens: "" })).toBe(true);
  });
});
