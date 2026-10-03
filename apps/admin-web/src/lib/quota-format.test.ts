// ADM-FR-40 · ADM-FR-41 · M4-R06 · định dạng và mức quota.
import { describe, expect, test } from "bun:test";
import { formatCount, formatQuotaValue, formatUsd, pctLevel, pctOf } from "./quota-format";

describe("ADM-FR-41 · pctOf / pctLevel", () => {
  test("không giới hạn → null / none", () => {
    expect(pctOf(5, null)).toBeNull();
    expect(pctOf(5, 0)).toBeNull();
    expect(pctLevel(null)).toBe("none");
  });
  test("làm tròn xuống; 79 none, 80 warn, 99 warn, 100 over", () => {
    expect(pctOf(799, 1000)).toBe(79);
    expect(pctLevel(79)).toBe("none");
    expect(pctLevel(80)).toBe("warn");
    expect(pctLevel(99)).toBe("warn");
    expect(pctLevel(100)).toBe("over");
    expect(pctLevel(pctOf(1500, 1000))).toBe("over");
  });
});

describe("ADM-FR-42 · định dạng theo locale", () => {
  test("đếm: nhóm hàng nghìn, triệu rút gọn M", () => {
    expect(formatCount(820, "vi")).toBe("820");
    expect(formatCount(1000, "vi")).toBe("1.000");
    expect(formatCount(1000, "en")).toBe("1,000");
    expect(formatCount(4_100_000, "vi")).toBe("4,1M");
    expect(formatCount(4_100_000, "en")).toBe("4.1M");
  });
  test("USD", () => {
    expect(formatUsd("212.4", "vi").replace(/\s/g, " ")).toBe("212,40 US$");
    expect(formatUsd("300", "en")).toBe("$300.00");
    expect(formatQuotaValue("usd", "0.5", "en")).toBe("$0.50");
    expect(formatQuotaValue("runs", "1000", "en")).toBe("1,000");
  });
});
