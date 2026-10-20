// nav-v2 + V2-J1 · Sản phẩm & Giá: tab và tham số URL của /products (tuyến cũ chuyển vào đây giữ `product`/`filter`/`lot`).
import { describe, expect, test } from "bun:test";
import { PRODUCT_TABS, parseProductsSearch, tabOf } from "./tabs";

describe("tabOf", () => {
  test("4 tab; vắng/lạ ⇒ Sản phẩm", () => {
    expect(PRODUCT_TABS).toEqual(["catalog", "prices", "cks", "sourcing"]);
    expect(tabOf("cks")).toBe("cks");
    expect(tabOf("prices")).toBe("prices");
    expect(tabOf(undefined)).toBe("catalog");
    expect(tabOf("zzz")).toBe("catalog");
  });
});

describe("parseProductsSearch", () => {
  test("giữ tab prices/cks/sourcing + product/filter/lot; tab=catalog là mặc định nên bỏ", () => {
    expect(parseProductsSearch({ tab: "cks", filter: "expiring", lot: "L1" })).toEqual({
      tab: "cks",
      filter: "expiring",
      lot: "L1",
    });
    expect(parseProductsSearch({ tab: "prices", product: "gao" })).toEqual({
      tab: "prices",
      product: "gao",
    });
    expect(parseProductsSearch({ tab: "catalog" })).toEqual({});
  });
  test("danh sách sản phẩm: nhóm `g`; chi tiết `sp` kèm `ht` (ht không có sp bị bỏ)", () => {
    expect(parseProductsSearch({ g: "service" })).toEqual({ g: "service" });
    expect(parseProductsSearch({ g: "x", ht: "contracts" })).toEqual({});
    expect(parseProductsSearch({ sp: "abc", ht: "contracts" })).toEqual({
      sp: "abc",
      ht: "contracts",
    });
  });
  test("rác: giá trị rỗng, quá dài, sai kiểu bị bỏ", () => {
    expect(parseProductsSearch({ tab: "x", product: "", filter: 5, lot: "a".repeat(201) })).toEqual(
      {},
    );
  });
});
