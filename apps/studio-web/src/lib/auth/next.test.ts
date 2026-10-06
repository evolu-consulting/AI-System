// HUB-FR-72 · `next` chống open redirect (plan-frontend §2).
import { describe, expect, test } from "bun:test";
import { safeNext } from "./next";

describe("HUB-FR-72 · safeNext", () => {
  test("nhận đường dẫn nội bộ (kèm query/hash)", () => {
    expect(safeNext("/agents")).toBe("/agents");
    expect(safeNext("/agents?q=hoa&status=off")).toBe("/agents?q=hoa&status=off");
    expect(safeNext("/orchestrator#x")).toBe("/orchestrator#x");
  });

  test.each([
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["javascript:alert(1)"],
    ["agents"],
    [""],
    ["/login"],
    ["/login?next=/agents"],
    [`/${"a".repeat(2048)}`],
  ])("từ chối %p", (raw) => {
    expect(safeNext(raw)).toBeUndefined();
  });

  test("không phải chuỗi → undefined", () => {
    expect(safeNext(undefined)).toBeUndefined();
    expect(safeNext(42)).toBeUndefined();
  });
});
