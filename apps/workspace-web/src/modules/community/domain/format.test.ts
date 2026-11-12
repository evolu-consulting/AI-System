// Dải deal bảng tin (community-feed-redesign): chọn ô hero + ô phụ theo loại bài.
import { describe, expect, test } from "bun:test";
import { dealStrip, formatQty } from "./format";

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

describe("formatQty", () => {
  test("numeric DB 4 số lẻ ⇒ bỏ số 0 thừa theo locale vi", () => {
    expect(formatQty("320.0000 cuộn", "vi-VN")).toBe("320 cuộn");
    expect(formatQty("1250.5000 kg", "vi-VN")).toBe("1.250,5 kg");
    expect(formatQty("12.5000", "en-US")).toBe("12.5");
  });
  test("chuỗi người dùng gõ giữ nguyên", () => {
    expect(formatQty("8 tấn", "vi-VN")).toBe("8 tấn");
    expect(formatQty("1.250 kg", "vi-VN")).toBe("1.250 kg");
  });
  test("dealStrip dùng formatQty", () => {
    const d = dealStrip({ type: "sell", title: "A", fields: { qty: "320.0000 cuộn", price: "1" } });
    expect(d?.cells[0]?.v).toBe("320 cuộn");
  });
});
