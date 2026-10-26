// CR-097 G1 · GD-FR-01…05: luật thuần của Giao dịch (viết TRƯỚC code — phần tiền/kho, Luật 0b).
import { describe, expect, it } from "bun:test";
import type { DComp } from "./delivery.rules";
import {
  canDo,
  describeChanges,
  obligationOf,
  planLines,
  stockMovesOf,
  TxRuleError,
} from "./transactions.rules";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const comps: DComp[] = [
  { id: C1, productId: P1, name: "Băng keo", mode: "stock", ord: 0 },
  { id: C2, productId: P2, name: "Chữ ký số", mode: "quota", ord: 0 },
  { id: C3, productId: P2, name: "Cài đặt", mode: "order", ord: 1 },
];

describe("GD-FR-01/03/04/05 · chuyển trạng thái", () => {
  it("nháp: sửa/xoá/ghi sổ; đã ghi sổ: mô tả/điều chỉnh/huỷ; đã huỷ: không gì", () => {
    expect(["edit", "delete", "post"].every((a) => canDo("draft", a as never))).toBe(true);
    expect(canDo("draft", "adjust")).toBe(false);
    expect(canDo("draft", "cancel")).toBe(false);
    expect(["describe", "adjust", "cancel"].every((a) => canDo("posted", a as never))).toBe(true);
    expect(canDo("posted", "edit")).toBe(false);
    expect(canDo("posted", "delete")).toBe(false);
    expect(canDo("posted", "post")).toBe(false);
    for (const a of ["edit", "delete", "post", "describe", "adjust", "cancel"] as const)
      expect(canDo("cancelled", a)).toBe(false);
  });
});

describe("planLines · thành tiền + tổng", () => {
  it("tiền = SL × đơn giá (làm tròn đồng), tổng cộng các dòng; dòng không SP được phép", () => {
    const r = planLines(
      [
        { name: "Băng keo", product_id: P1, qty: "2.5", unit_price: 10_001 },
        { name: "Phí vận chuyển", qty: "1", unit_price: 50_000 },
      ],
      comps,
    );
    expect(r.lines.map((l) => [l.ord, l.qty, l.amount])).toEqual([
      [0, "2.5", 25_003],
      [1, "1", 50_000],
    ]);
    expect(r.total).toBe(75_003);
  });
  it("SL ≤ 0 / sai dạng, SP không có, thành phần không thuộc SP ⇒ invalid", () => {
    const bad = (l: Parameters<typeof planLines>[0][number]) => () => planLines([l], comps);
    expect(bad({ name: "x", qty: "0", unit_price: 1 })).toThrow(TxRuleError);
    expect(bad({ name: "x", qty: "1.23456", unit_price: 1 })).toThrow(TxRuleError);
    expect(bad({ name: "x", product_id: C1, qty: "1", unit_price: 1 })).toThrow(TxRuleError);
    expect(
      bad({ name: "x", product_id: P1, component_ids: [C2], qty: "1", unit_price: 1 }),
    ).toThrow(TxRuleError);
  });
  it("tổng vượt 10¹⁵ ⇒ invalid", () => {
    expect(() =>
      planLines([{ name: "x", qty: "99999999999", unit_price: 999_999_999_999 }], comps),
    ).toThrow(TxRuleError);
  });
});

describe("stockMovesOf · cùng luật kho của giao hàng HĐ", () => {
  const lines = (deal: "buy" | "sell") =>
    planLines(
      [
        { name: "Băng keo", product_id: P1, qty: "10", unit_price: 5_000 },
        { name: "CKS", product_id: P2, qty: "3", unit_price: 900_000 },
        { name: "Phí", qty: "1", unit_price: 1 },
      ],
      comps,
    ).lines.map((l, i) => ({ ...l, id: `00000000-0000-4000-8000-00000000000${i}`, deal }));

  it("mua: nhập mọi thành phần có kho/suất/đơn (giá chia đều), gói suất hạn = valid_until; không ref HĐ", () => {
    const m = stockMovesOf(
      { deal: "buy", partyKey: "tax:0100684378", validUntil: "2027-10-01" },
      lines("buy"),
      comps,
    );
    expect(m.map((x) => [x.componentId, x.direction, x.qty, x.unitPrice])).toEqual([
      [C1, "in", "10", 5_000],
      [C2, "in", "3", 450_000],
      [C3, "in", "3", 450_000],
    ]);
    expect(m[1]?.expiresOn).toBe("2027-10-01");
    expect(m.every((x) => x.supplierPartyKey === "tax:0100684378")).toBe(true);
    expect(m.every((x) => !x.contractId && !x.milestoneId && !x.contractItemId)).toBe(true);
  });
  it("bán: xuất theo BQ (không đơn giá), bỏ thành phần đặt theo khách", () => {
    const m = stockMovesOf(
      { deal: "sell", partyKey: "tax:1", validUntil: null },
      lines("sell"),
      comps,
    );
    expect(m.map((x) => [x.componentId, x.direction, x.qty, x.unitPrice ?? null])).toEqual([
      [C1, "out", "10", null],
      [C2, "out", "3", null],
    ]);
  });
  it("mua gói suất không có hạn ⇒ invalid", () => {
    expect(() =>
      stockMovesOf({ deal: "buy", partyKey: null, validUntil: null }, lines("buy"), comps),
    ).toThrow(TxRuleError);
  });
});

describe("obligationOf · nghĩa vụ thanh toán của giao dịch", () => {
  it("bán ⇒ thu, mua ⇒ trả; hạn = due_on ?? ngày phát sinh; số = tổng − đã xong; seq = rev + 1", () => {
    expect(
      obligationOf({
        deal: "sell",
        total: 100,
        done: 0,
        dueOn: null,
        occurredOn: "2026-10-01",
        rev: 0,
      }),
    ).toEqual({ direction: "receive", amount: 100, dueDate: "2026-10-01", seq: 1 });
    expect(
      obligationOf({
        deal: "buy",
        total: 100,
        done: 30,
        dueOn: "2026-11-01",
        occurredOn: "2026-10-01",
        rev: 2,
      }),
    ).toEqual({ direction: "pay", amount: 70, dueDate: "2026-11-01", seq: 3 });
  });
  it("tổng 0 hoặc đã xong đủ ⇒ không sinh nghĩa vụ", () => {
    const base = { deal: "sell" as const, dueOn: null, occurredOn: "2026-10-01", rev: 0 };
    expect(obligationOf({ ...base, total: 0, done: 0 })).toBeNull();
    expect(obligationOf({ ...base, total: 100, done: 100 })).toBeNull();
    expect(obligationOf({ ...base, total: 100, done: 120 })).toBeNull();
  });
});

describe("describeChanges · GD-FR-03 mô tả sửa trực tiếp", () => {
  it("chỉ trường đổi thật; không đổi gì ⇒ invalid", () => {
    const before = { note: "a", holder: null, lot_label: "L1" };
    expect(describeChanges(before, { note: "b", lot_label: "L1" })).toEqual({
      note: { from: "a", to: "b" },
    });
    expect(describeChanges(before, { holder: "Lan" })).toEqual({
      holder: { from: null, to: "Lan" },
    });
    expect(() => describeChanges(before, { note: "a" })).toThrow(TxRuleError);
  });
});
