// delivery-opts · bảng "Giao đợt này": nháp ↔ thân PATCH, nhận biết sửa, kiểm vượt phần còn lại.
import { describe, expect, test } from "bun:test";
import { draftsOf, editOf, shortList } from "./delivery-lines";

const view = {
  milestone_id: "m",
  status: "open",
  pct: 30,
  allow_negative: false,
  rows: [
    {
      item_id: "a",
      name: "A",
      unit: "cái",
      product_id: "p",
      on_contract: "100",
      delivered: "0",
      this_time: "30",
      remaining: "100",
    },
    {
      item_id: "b",
      name: "B",
      unit: null,
      product_id: null,
      on_contract: "2.5",
      delivered: "0",
      this_time: "0.75",
      remaining: "2.5",
    },
    {
      item_id: "c",
      name: "C",
      unit: null,
      product_id: null,
      on_contract: null,
      delivered: "0",
      this_time: "0",
      remaining: null,
    },
  ],
};

describe("delivery-opts · bảng giao đợt này", () => {
  test("SL tính sẵn hiện kiểu Việt, dòng không ghi SL bị bỏ; chưa sửa ⇒ không dirty", () => {
    const d = draftsOf(view);
    expect(d.map((x) => x.qty)).toEqual(["30", "0,75"]);
    const e = editOf(d);
    expect(e).toEqual({
      dirty: false,
      bad: false,
      items: [
        { item_id: "a", qty: 30 },
        { item_id: "b", qty: 0.75 },
      ],
    });
  });

  test("sửa một ô ⇒ dirty; vượt phần còn lại hoặc không phải số ⇒ bad", () => {
    const d = draftsOf(view);
    const first = d[0];
    if (!first) throw new Error("thiếu dòng");
    expect(editOf([{ ...first, qty: "40" }]).dirty).toBe(true);
    expect(editOf([{ ...first, qty: "101" }]).bad).toBe(true);
    expect(editOf([{ ...first, qty: "abc" }]).bad).toBe(true);
    expect(editOf([{ ...first, qty: "" }]).items).toEqual([{ item_id: "a", qty: 0 }]);
  });

  test("shortList chỉ liệt kê thành phần thiếu kho", () => {
    expect(shortList(null)).toBe("");
    expect(
      shortList({
        over_stock: true,
        components: [
          {
            component_id: "1",
            product_id: "p",
            name: "X",
            mode: "stock",
            need: "50",
            on_hand: "20",
            over: true,
          },
          {
            component_id: "2",
            product_id: "p",
            name: "Y",
            mode: "stock",
            need: "1",
            on_hand: "20",
            over: false,
          },
        ],
      }),
    ).toBe("X (50 / 20)");
  });
});
