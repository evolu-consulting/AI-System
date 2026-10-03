import { describe, expect, test } from "bun:test";
import { priceDisplay } from "./unpriced";

describe("priceDisplay (ADM-FR-42)", () => {
  test("không có hàng chưa định giá → số tiền", () => {
    expect(priceDisplay(0, 5)).toBe("amount");
    expect(priceDisplay(0, 0)).toBe("amount");
  });
  test("mọi hàng chưa định giá → chỉ nhãn", () => {
    expect(priceDisplay(5, 5)).toBe("unpriced");
    expect(priceDisplay(1, 1)).toBe("unpriced");
  });
  test("một phần → số tiền + nhãn", () => {
    expect(priceDisplay(2, 5)).toBe("partial");
  });
});
