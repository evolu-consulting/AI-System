// CR-155 · mã lỗi đọc ⇒ khoá lý do; hết giờ đọc (TIMEOUT/STALE) ⇒ "timeout".
import { describe, expect, it } from "bun:test";
import { failReasonKey } from "./fail-reason";

describe("failReasonKey", () => {
  it("TIMEOUT và STALE ⇒ timeout (AI đọc quá lâu)", () => {
    expect(failReasonKey("TIMEOUT")).toBe("timeout");
    expect(failReasonKey("STALE")).toBe("timeout");
  });
  it("mã cũ giữ nguyên; mã lạ / vắng ⇒ undefined", () => {
    expect(failReasonKey("PDF_TOO_LARGE")).toBe("tooLarge");
    expect(failReasonKey("AI_CAP_EXCEEDED")).toBe("cap");
    expect(failReasonKey("SAVE_FAILED")).toBeUndefined();
    expect(failReasonKey(null)).toBeUndefined();
  });
});
