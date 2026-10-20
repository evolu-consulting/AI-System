// V2-D · luật thuần mốc giao: SL giao lần này (5.7a), dòng nhập/xuất (5.7c/f), thông báo (5.7d).
import { describe, expect, it } from "bun:test";
import {
  checkPlan,
  type DComp,
  type DCtx,
  type DeliveryError,
  type DItem,
  deliveryLines,
  deliveryMoves,
  qtyIn,
  qtyOf,
  stockNotes,
} from "./delivery.rules";

const Q = (n: number) => BigInt(Math.round(n * 10_000));
const it_ = (o: Partial<DItem> & { id: string }): DItem => ({
  name: o.id,
  qty: Q(100),
  unitPrice: 1_000,
  productId: `p-${o.id}`,
  componentIds: null,
  delivered: 0n,
  ...o,
});
const ctx = (o: Partial<DCtx> = {}): DCtx => ({
  deal: "buy",
  contractId: "k",
  milestoneId: "m",
  endDate: "2027-12-31",
  supplierKey: "tax:1",
  milestoneQty: null,
  ...o,
});
const comp = (id: string, productId: string, mode: DComp["mode"], ord = 0): DComp => ({
  id,
  productId,
  name: id,
  mode,
  ord,
});
const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as DeliveryError).code;
  }
};

describe("deliveryLines (5.7a)", () => {
  it("không bảng SL ⇒ giao hết phần còn lại mọi dòng có SL; dòng đã đủ bỏ qua", () => {
    const items = [
      it_({ id: "a", delivered: Q(40) }),
      it_({ id: "b", delivered: Q(100) }),
      it_({ id: "c", qty: null }),
    ];
    expect(deliveryLines(items, new Map(), ctx())).toEqual([
      { itemId: "a", qty: Q(60), planned: null },
    ]);
  });
  it("bảng SL: dòng trống không giao; null = phần còn lại; vượt ⇒ over", () => {
    const items = [it_({ id: "a", delivered: Q(10) }), it_({ id: "b" })];
    expect(deliveryLines(items, new Map([["a", null]]), ctx())).toEqual([
      { itemId: "a", qty: Q(90), planned: null },
    ]);
    expect(code(() => deliveryLines(items, new Map([["b", Q(100.0001)]]), ctx()))).toBe("over");
  });
  it("SL chung cũ: chỉ HĐ một dòng có SL", () => {
    expect(deliveryLines([it_({ id: "a" })], new Map(), ctx({ milestoneQty: Q(5) }))).toEqual([
      { itemId: "a", qty: Q(5), planned: Q(5) },
    ]);
    expect(
      code(() =>
        deliveryLines([it_({ id: "a" }), it_({ id: "b" })], new Map(), ctx({ milestoneQty: Q(5) })),
      ),
    ).toBe("invalid");
  });
  it("checkPlan: dòng lạ / trùng ⇒ invalid; 0 luôn được", () => {
    const items = [it_({ id: "a" })];
    expect(checkPlan(items, [{ itemId: "x", qty: Q(1) }])?.code).toBe("invalid");
    expect(
      checkPlan(items, [
        { itemId: "a", qty: 0n },
        { itemId: "a", qty: 0n },
      ])?.code,
    ).toBe("invalid");
    expect(checkPlan([it_({ id: "a", qty: null })], [{ itemId: "a", qty: 0n }])).toBeNull();
    expect(checkPlan([it_({ id: "a", qty: null })], [{ itemId: "a", qty: Q(1) }])?.code).toBe(
      "over",
    );
  });
});

describe("deliveryMoves (5.7c/f)", () => {
  const line = { itemId: "a", qty: Q(3), planned: null };
  it("Mua: nhập theo giá dòng; gói suất hạn = ngày kết thúc; đặt theo khách vẫn ghi giá vốn đơn", () => {
    const comps = [
      comp("q", "p-a", "quota", 0),
      comp("s", "p-a", "stock", 1),
      comp("o", "p-a", "order", 2),
    ];
    const mv = deliveryMoves([line], [it_({ id: "a", unitPrice: 1_000 })], comps, ctx());
    expect(mv.map((m) => [m.componentId, m.direction, m.unitPrice, m.expiresOn ?? null])).toEqual([
      ["q", "in", 334, "2027-12-31"],
      ["s", "in", 333, null],
      ["o", "in", 333, null],
    ]);
  });
  it("Mua: thiếu đơn giá / gói thiếu ngày kết thúc ⇒ invalid", () => {
    const comps = [comp("q", "p-a", "quota")];
    expect(
      code(() => deliveryMoves([line], [it_({ id: "a", unitPrice: null })], comps, ctx())),
    ).toBe("invalid");
    expect(
      code(() => deliveryMoves([line], [it_({ id: "a" })], comps, ctx({ endDate: null }))),
    ).toBe("invalid");
  });
  it("Bán: xuất không giá; bỏ đặt theo khách + Giới thiệu; thành phần đã chọn phải thuộc SP", () => {
    const comps = [
      comp("s", "p-a", "stock", 0),
      comp("o", "p-a", "order", 1),
      comp("n", "p-a", "none", 2),
    ];
    const mv = deliveryMoves([line], [it_({ id: "a" })], comps, ctx({ deal: "sell" }));
    expect(mv.map((m) => [m.componentId, m.direction, m.unitPrice ?? null])).toEqual([
      ["s", "out", null],
    ]);
    const picked = deliveryMoves(
      [line],
      [it_({ id: "a", componentIds: ["o"] })],
      comps,
      ctx({ deal: "sell" }),
    );
    expect(picked).toEqual([]);
    expect(
      code(() => deliveryMoves([line], [it_({ id: "a", componentIds: ["zz"] })], comps, ctx())),
    ).toBe("invalid");
  });
  it("Giới thiệu / dòng không gắn SP ⇒ không dòng kho", () => {
    const comps = [comp("s", "p-a", "stock")];
    expect(deliveryMoves([line], [it_({ id: "a" })], comps, ctx({ deal: "referral" }))).toEqual([]);
    expect(deliveryMoves([line], [it_({ id: "a", productId: null })], comps, ctx())).toEqual([]);
  });
});

describe("stockNotes + SL", () => {
  it("kho trước → sau, giá vốn khi đổi; gói suất; đặt theo khách", () => {
    const base = { productId: "p", valueBefore: 0, valueAfter: 0 };
    expect(
      stockNotes([
        {
          ...base,
          componentId: "a",
          name: "Băng keo 5cm",
          mode: "stock",
          onHandBefore: "320",
          onHandAfter: "620",
          avgCostBefore: 10_000,
          avgCostAfter: 10_968,
        },
        {
          ...base,
          componentId: "b",
          name: "CTS",
          mode: "quota",
          onHandBefore: "5",
          onHandAfter: "4",
          avgCostBefore: 1,
          avgCostAfter: 1,
        },
        {
          ...base,
          componentId: "c",
          name: "In",
          mode: "order",
          onHandBefore: "0",
          onHandAfter: "0",
          avgCostBefore: 0,
          avgCostAfter: 0,
        },
      ]),
    ).toEqual([
      "kho Băng keo 5cm: 320 → 620",
      "giá vốn Băng keo 5cm: 10.000 → 10.968",
      "suất CTS: 5 → 4",
      "In: đặt theo khách, kho không đổi",
    ]);
  });
  it("qtyOf / qtyIn", () => {
    expect([qtyOf("12.5000"), qtyOf("3"), qtyOf(null)]).toEqual([125_000n, 30_000n, null]);
    expect([qtyIn(0), qtyIn(2.5), qtyIn(40)]).toEqual([0n, 25_000n, 400_000n]);
  });
});
