// CR-127 · X2 · luật thuần gắn giao dịch vào mốc: ánh xạ dòng → dòng HĐ (LINK_MIXED), giá trị giao dịch, LINK_REQUIRED/LINK_REASON_REQUIRED.
import { describe, expect, it } from "bun:test";
import { linkQtyItems, linkVerdict, transactionTotal } from "./deal.rules";

const items = [
  { id: "i1", product_id: "p1" },
  { id: "i2", product_id: "p2" },
  { id: "i3", product_id: "p1" },
];

describe("linkQtyItems", () => {
  it("ánh xạ theo SP, cộng dồn vào dòng HĐ đầu tiên của SP, bỏ dòng không SL", () => {
    expect(
      linkQtyItems(
        [
          { product_id: "p1", qty: 3 },
          { product_id: "p1", qty: 2 },
          { product_id: "p2", qty: null },
        ],
        items,
      ),
    ).toEqual({ mixed: false, qty_items: [{ contract_item_id: "i1", qty: 5 }] });
  });
  it("dòng không gắn SP hoặc SP ngoài HĐ ⇒ mixed", () => {
    expect(linkQtyItems([{ product_id: "p9", qty: 1 }], items)).toEqual({ mixed: true });
    expect(linkQtyItems([{ qty: 1 }], items)).toEqual({ mixed: true });
  });
  it("không có dòng ⇒ không mixed, qty_items rỗng (đủ phần còn lại)", () => {
    expect(linkQtyItems([], items)).toEqual({ mixed: false, qty_items: [] });
  });
});

describe("transactionTotal", () => {
  it("ưu tiên total_value; vắng ⇒ Σ SL×đơn giá; không đủ số ⇒ null", () => {
    expect(transactionTotal(500, [{ qty: 2, unit_price: 10 }])).toBe(500);
    expect(
      transactionTotal(null, [
        { qty: 2, unit_price: 10 },
        { qty: 1, unit_price: 5 },
      ]),
    ).toBe(25);
    expect(transactionTotal(undefined, [{ qty: 2 }])).toBeNull();
  });
});

describe("linkVerdict", () => {
  it("đối tác còn HĐ mở: không chọn ⇒ link_required; none không lý do ⇒ reason_required", () => {
    expect(linkVerdict(undefined, true)).toBe("link_required");
    expect(linkVerdict({ none: { reason: " " } }, true)).toBe("reason_required");
    expect(linkVerdict({ none: { reason: "mua lẻ" } }, true)).toBe("ok");
    expect(linkVerdict({ obligation_id: "x" }, true)).toBe("ok");
  });
  it("đối tác không có HĐ mở: luôn ok", () => {
    expect(linkVerdict(undefined, false)).toBe("ok");
    expect(linkVerdict({ none: { reason: "" } }, false)).toBe("ok");
  });
});
