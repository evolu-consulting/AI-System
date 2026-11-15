import { describe, expect, it } from "bun:test";
import vi from "../../../../../../packages/i18n/locales/contracts/vi.json";
import { failReasonKey } from "./fail-reason";

describe("failReasonKey", () => {
  it("AGENT_UNAVAILABLE ⇒ câu riêng 'AI đang tạm ngưng', không phải 'định dạng' hay timeout", () => {
    expect(failReasonKey("AGENT_UNAVAILABLE")).toBe("aiDown");
    const r = vi.contracts.review.failReason as Record<string, string>;
    expect(r.aiDown).toContain("AI đang tạm ngưng");
    expect(r.aiDown).toContain("Thử lại");
  });
  it("AI_CAP_EXCEEDED ⇒ cap; TIMEOUT/mã lạ ⇒ câu chung", () => {
    expect(failReasonKey("AI_CAP_EXCEEDED")).toBe("cap");
    expect(failReasonKey("TIMEOUT")).toBeUndefined();
    expect(failReasonKey(null)).toBeUndefined();
  });
});
