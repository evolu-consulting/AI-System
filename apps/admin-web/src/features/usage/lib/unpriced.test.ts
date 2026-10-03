import { describe, expect, test } from "bun:test";
import { priceDisplay } from "./unpriced";

describe("priceDisplay (ADM-FR-42)", () => {
  test("không có hàng chưa định giá → số tiền", () => {
    expect(priceDisplay(0, "1.50")).toBe("amount");
    expect(priceDisplay(0, "0")).toBe("amount");
  });
  test("có hàng chưa định giá và billable = 0 → chỉ nhãn", () => {
    expect(priceDisplay(1, "0")).toBe("unpriced");
    expect(priceDisplay(3, "0.000000")).toBe("unpriced");
  });
  test("1 run 2 hàng: $0.10 + NULL → partial, không ẩn $0.10", () => {
    expect(priceDisplay(1, "0.10")).toBe("partial");
  });
  test("chỉ hàng run_id NULL (runs=0), 1/3 chưa định giá, billable > 0 → partial", () => {
    expect(priceDisplay(1, "2.40")).toBe("partial");
  });
});
