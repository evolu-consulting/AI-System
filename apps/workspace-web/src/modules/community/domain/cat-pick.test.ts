import { describe, expect, test } from "bun:test";
import { catsSummary, filterCats, toggleCat } from "./cat-pick";

describe("cat-pick", () => {
  test("catsSummary: rút gọn +N", () => {
    expect(catsSummary(["A"])).toBe("A");
    expect(catsSummary(["A", "B"])).toBe("A, B");
    expect(catsSummary(["A", "B", "C", "D"])).toBe("A, B +2");
  });
  test("catsSummary: chưa chọn ⇒ rỗng", () => {
    expect(catsSummary([])).toBe("");
  });
  test("filterCats: bỏ dấu, không phân biệt hoa thường", () => {
    const cats = ["Thép xây dựng", "Đồng", "Nhựa"];
    expect(filterCats(cats, "THEP")).toEqual(["Thép xây dựng"]);
    expect(filterCats(cats, "dong")).toEqual(["Đồng"]);
    expect(filterCats(cats, "  ")).toEqual(cats);
  });
  test("toggleCat", () => {
    expect(toggleCat(["A"], "B")).toEqual(["A", "B"]);
    expect(toggleCat(["A", "B"], "A")).toEqual(["B"]);
  });
});
