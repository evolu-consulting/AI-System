// nav-v2 + V2-J1 + V2-O · tham số URL của /products.
import { describe, expect, test } from "bun:test";
import { parseProductsSearch } from "./tabs";

describe("parseProductsSearch", () => {
  test("danh sách sản phẩm: nhóm `g`; chi tiết `sp` kèm `ht` (ht không có sp bị bỏ)", () => {
    expect(parseProductsSearch({ g: "service" })).toEqual({ g: "service" });
    expect(parseProductsSearch({ g: "x", ht: "contracts" })).toEqual({});
    expect(parseProductsSearch({ sp: "abc", ht: "contracts" })).toEqual({
      sp: "abc",
      ht: "contracts",
    });
  });
  test("link cũ (tab/product/filter/lot) và rác bị bỏ", () => {
    expect(
      parseProductsSearch({ tab: "cks", filter: "expiring", lot: "L1", product: "gao" }),
    ).toEqual({});
    expect(parseProductsSearch({ sp: "a".repeat(65), g: 5 })).toEqual({});
  });
});
