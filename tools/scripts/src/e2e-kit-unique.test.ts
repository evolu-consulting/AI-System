import { describe, expect, test } from "bun:test";
import { uniqueKey, uniqueSuffix } from "../../../e2e/_kit/unique";

describe("e2e/_kit unique", () => {
  test("uniqueSuffix: không trùng trong 1000 lần, chỉ [a-z0-9]", () => {
    const s = new Set(Array.from({ length: 1000 }, () => uniqueSuffix()));
    expect(s.size).toBe(1000);
    for (const v of s) expect(v).toMatch(/^[a-z0-9]{8,12}$/);
  });
  test("uniqueKey: chuẩn hoá tiền tố", () => {
    expect(uniqueKey("Flows CS!", "abc")).toBe("e2e-flows-cs-abc");
  });
});
