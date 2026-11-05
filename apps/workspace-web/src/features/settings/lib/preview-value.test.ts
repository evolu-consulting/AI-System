import { describe, expect, test } from "bun:test";
import type { CurrentStep } from "./current-flow";
import {
  digitsFromValue,
  digitsOf,
  formatDigits,
  parseValue,
  QUICK_VALUES,
  runSummary,
} from "./preview-value";

describe("preview-value · gõ/đọc số", () => {
  test("ngăn nghìn kiểu vi-VN khi gõ, đọc ngược về số", () => {
    expect(formatDigits(digitsOf("500000000"))).toBe("500.000.000");
    expect(formatDigits(digitsOf("1.234"))).toBe("1.234");
    expect(formatDigits(digitsOf("12"))).toBe("12");
    expect(parseValue("500.000.000")).toBe(500_000_000);
    expect(parseValue("1,000")).toBe(1000);
  });
  test("rỗng / chữ ⇒ null; số 0 đầu bỏ; cắt 15 chữ số; không âm", () => {
    expect(parseValue("")).toBeNull();
    expect(parseValue("abc")).toBeNull();
    expect(digitsOf("007")).toBe("7");
    expect(digitsOf("0")).toBe("0");
    expect(digitsOf("-5")).toBe("5");
    expect(digitsOf("1".repeat(20))).toHaveLength(15);
  });
  test("chip nhanh: 100 triệu, 500 triệu, 1 tỷ, để trống ⇒ ô hiển thị đúng", () => {
    expect(QUICK_VALUES.map((q) => formatDigits(digitsFromValue(q.value)))).toEqual([
      "100.000.000",
      "500.000.000",
      "1.000.000.000",
      "",
    ]);
  });
});

describe("preview-value · runSummary", () => {
  const s = (name: string): CurrentStep => ({
    key: name,
    name,
    department: null,
    kind: "review",
    when: null,
    dueH: null,
    remindH: null,
    escalateGroup: null,
    approverCount: null,
  });
  test("đếm bước chạy / tổng và giữ thứ tự tên", () => {
    expect(runSummary([s("A"), s("B"), s("C")], [true, false, true])).toEqual({
      n: 2,
      m: 3,
      names: ["A", "C"],
    });
  });
});
