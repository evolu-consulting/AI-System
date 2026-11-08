import { describe, expect, test } from "bun:test";
import { contractCodeLabel, contractCodeOf, contractNameOf } from "./contract-name";

describe("CR-125 c3 · contract-name (TS)", () => {
  const both = { number: "HD-01", title: "Hợp đồng A" };
  test("tên trước, mã trước, thiếu thì lùi về cái còn lại", () => {
    expect(contractNameOf(both)).toBe("Hợp đồng A");
    expect(contractCodeOf(both)).toBe("HD-01");
    expect(contractNameOf({ number: "HD-01", title: null })).toBe("HD-01");
    expect(contractCodeOf({ number: null, title: "Hợp đồng A" })).toBe("Hợp đồng A");
    expect(contractNameOf(null)).toBeNull();
  });
  test("nhãn chuông cắt 120 ký tự, thiếu ⇒ rỗng", () => {
    expect(contractCodeLabel({ number: "x".repeat(200) })).toHaveLength(120);
    expect(contractCodeLabel(null)).toBe("");
  });
});
