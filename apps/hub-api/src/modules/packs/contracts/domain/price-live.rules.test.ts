// CR-127 K2a-2 (BR-07): `isPriceLive` / `effectiveStateOf` — một định nghĩa "HĐ còn hiệu lực cho giá".
import { describe, expect, it } from "bun:test";
import { effectiveStateOf, isPriceLive } from "./price-live.rules";

describe("isPriceLive", () => {
  it("done + effect active/expiring/renewed ⇒ còn hiệu lực", () => {
    for (const effect of ["active", "expiring", "renewed"])
      expect(isPriceLive({ status: "done", effect })).toBe(true);
  });
  it("done mà chưa tới ngày / hết hạn / chấm dứt / chưa nạp effect ⇒ không", () => {
    for (const effect of ["not_started", "expired", "terminated", null, undefined])
      expect(isPriceLive({ status: "done", effect })).toBe(false);
  });
  it("chưa done thì effect nào cũng không tính", () => {
    for (const status of ["draft", "processing", "reject"])
      expect(isPriceLive({ status, effect: "active" })).toBe(false);
  });
});

describe("effectiveStateOf", () => {
  it("done ⇒ effect; không có effect hoặc chưa done ⇒ giữ trạng thái", () => {
    expect(effectiveStateOf({ status: "done", effect: "expiring" })).toBe("expiring");
    expect(effectiveStateOf({ status: "done", effect: null })).toBe("done");
    expect(effectiveStateOf({ status: "draft", effect: "active" })).toBe("draft");
  });
});
