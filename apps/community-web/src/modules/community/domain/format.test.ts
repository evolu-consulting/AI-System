// Dải deal bảng tin (community-feed-redesign): chọn ô hero + ô phụ theo loại bài.
import { describe, expect, test } from "bun:test";
import { dealStrip } from "./format";

describe("dealStrip", () => {
  test("cần bán: hero = giá, ô phụ = số lượng + khu vực", () => {
    const d = dealStrip({
      type: "sell",
      title: "Xoài",
      fields: { product: "Xoài", qty: "8 tấn", price: "42.000₫/kg", area: "Tiền Giang" },
    });
    expect(d?.hero).toEqual({ k: "Giá chào", v: "42.000₫/kg" });
    expect(d?.cells).toEqual([
      { k: "Số lượng", v: "8 tấn" },
      { k: "Khu vực", v: "Tiền Giang" },
    ]);
  });
  test("cần bán không giá ⇒ Liên hệ", () => {
    expect(dealStrip({ type: "sell", title: "A", fields: { qty: "1", price: null } })?.hero.v).toBe(
      "Liên hệ",
    );
  });
  test("cần mua: hero = ngân sách, thêm hạn cần (dd/mm/yyyy)", () => {
    const d = dealStrip({
      type: "buy",
      title: "Chanh dây",
      fields: { qty: "15 tấn", budget: "~28.000₫/kg", area: "Bình Dương", neededBy: "2026-11-05" },
    });
    expect(d?.hero).toEqual({ k: "Ngân sách", v: "~28.000₫/kg" });
    expect(d?.cells.map((c) => c.k)).toEqual(["Cần", "Giao tại", "Cần trước"]);
    expect(d?.cells[2]?.v).toBe("05/11/2026");
  });
  test("không tiêu đề ⇒ thêm hàng hoá; thông báo ⇒ null", () => {
    expect(dealStrip({ type: "sell", fields: { product: "Keo" } })?.cells[0]).toEqual({
      k: "Hàng hoá",
      v: "Keo",
    });
    expect(dealStrip({ type: "note", fields: {} })).toBeNull();
  });
});
