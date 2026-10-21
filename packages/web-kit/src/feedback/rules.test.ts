import { describe, expect, it } from "bun:test";
import { canAdd, MAX_BYTES, pageOf } from "./rules";

describe("feedback web rules", () => {
  it("chỉ nhận loại cho phép, ≤ 2 MB, tối đa 3 tệp", () => {
    expect(canAdd(0, { name: "a.png", type: "image/png", size: 10 })).toBe(true);
    expect(canAdd(3, { name: "a.png", type: "image/png", size: 10 })).toBe(false);
    expect(canAdd(0, { name: "a.exe", type: "application/x-msdownload", size: 10 })).toBe(false);
    expect(canAdd(0, { name: "a.png", type: "image/png", size: MAX_BYTES + 1 })).toBe(false);
  });
  it("page_url bỏ origin và cắt 500", () => {
    expect(pageOf({ pathname: "/contracts/1", search: "?a=1" })).toBe("/contracts/1?a=1");
    expect(pageOf({ pathname: `/${"x".repeat(600)}` })).toHaveLength(500);
  });
});
