// nav-v2 · Sản phẩm & Giá: tab và tham số URL của /products (tuyến cũ chuyển vào đây giữ `product`/`filter`/`lot`).
import { describe, expect, test } from "bun:test";
import { PRODUCT_TABS, parseProductsSearch, tabOf } from "./tabs";

describe("tabOf", () => {
  test("3 tab; vắng/lạ ⇒ So sánh giá", () => {
    expect(PRODUCT_TABS).toEqual(["prices", "cks", "sourcing"]);
    expect(tabOf("cks")).toBe("cks");
    expect(tabOf("sourcing")).toBe("sourcing");
    expect(tabOf(undefined)).toBe("prices");
    expect(tabOf("zzz")).toBe("prices");
  });
});

describe("parseProductsSearch", () => {
  test("giữ tab cks/sourcing + product/filter/lot; tab=prices là mặc định nên bỏ", () => {
    expect(parseProductsSearch({ tab: "cks", filter: "expiring", lot: "L1" })).toEqual({
      tab: "cks",
      filter: "expiring",
      lot: "L1",
    });
    expect(parseProductsSearch({ tab: "prices", product: "gao" })).toEqual({ product: "gao" });
  });
  test("rác: giá trị rỗng, quá dài, sai kiểu bị bỏ", () => {
    expect(parseProductsSearch({ tab: "x", product: "", filter: 5, lot: "a".repeat(201) })).toEqual(
      {},
    );
  });
});
