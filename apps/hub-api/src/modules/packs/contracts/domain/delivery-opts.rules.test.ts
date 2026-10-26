// delivery-opts · luật thuần: đợt giao theo % (làm tròn, đợt cuối lấy phần còn lại) + giao vượt tồn (bật/tắt, nhập bù tồn âm).
import { describe, expect, it } from "bun:test";
import {
  type DCtx,
  type DItem,
  deliveryLines,
  overdrawNotes,
  pctOf,
  splitByPct,
} from "./delivery.rules";
import {
  type CompState,
  type DeliveryMove,
  fmtQty,
  type OpenLot,
  planDelivery,
  StockError,
} from "./stock.rules";

const Q = (n: number) => BigInt(Math.round(n * 10_000));
const item = (id: string, qty: number | null, delivered = 0): DItem => ({
  id,
  name: id,
  qty: qty === null ? null : Q(qty),
  unitPrice: 1000,
  productId: `p-${id}`,
  componentIds: null,
  delivered: Q(delivered),
});
const ctx = (o: Partial<DCtx> = {}): DCtx => ({
  deal: "sell",
  contractId: "k",
  milestoneId: "m",
  endDate: null,
  supplierKey: null,
  milestoneQty: null,
  ...o,
});

describe("splitByPct", () => {
  it("30% của 100 và 50 ⇒ 30 và 15", () => {
    const r = splitByPct([item("a", 100), item("b", 50)], pctOf(30) as bigint, 0n);
    expect(r).toEqual([
      { itemId: "a", qty: Q(30) },
      { itemId: "b", qty: Q(15) },
    ]);
  });

  it("SL nguyên làm tròn đơn vị (nửa lên): 33.33% của 10 ⇒ 3; 35% của 10 ⇒ 4", () => {
    expect(splitByPct([item("a", 10)], pctOf(33.33) as bigint, 0n)[0]?.qty).toBe(Q(3));
    expect(splitByPct([item("a", 10)], pctOf(35) as bigint, 0n)[0]?.qty).toBe(Q(4));
  });

  it("SL lẻ giữ 4 số lẻ: 25% của 2.5 ⇒ 0.625", () => {
    expect(splitByPct([item("a", 2.5)], pctOf(25) as bigint, 0n)[0]?.qty).toBe(Q(0.625));
  });

  it("đợt cuối (Σ % ≥ 100) lấy phần còn lại, tổng các đợt khớp SL HĐ dù làm tròn lệch", () => {
    // 3 đợt 33.33% / 33.33% / 33.34% trên 10 đơn vị: 3 + 3 + phần còn lại 4 = 10.
    const p1 = splitByPct([item("a", 10)], pctOf(33.33) as bigint, 0n)[0]?.qty as bigint;
    const p2 = splitByPct([item("a", 10, 3)], pctOf(33.33) as bigint, pctOf(33.33) as bigint)[0]
      ?.qty as bigint;
    const p3 = splitByPct([item("a", 10, 6)], pctOf(33.34) as bigint, pctOf(66.66) as bigint)[0]
      ?.qty as bigint;
    expect([p1, p2, p3]).toEqual([Q(3), Q(3), Q(4)]);
    expect(p1 + p2 + p3).toBe(Q(10));
  });

  it("không vượt phần còn lại; dòng không ghi SL bị bỏ qua", () => {
    const r = splitByPct([item("a", 10, 9), item("b", null)], pctOf(50) as bigint, 0n);
    expect(r).toEqual([{ itemId: "a", qty: Q(1) }]);
  });
});

describe("deliveryLines với %", () => {
  it("mốc có % và không có bảng SL ⇒ SL theo %; bảng SL người dùng sửa thắng %", () => {
    const items = [item("a", 100)];
    const c = ctx({ pct: pctOf(30) });
    expect(deliveryLines(items, new Map(), c)).toEqual([
      { itemId: "a", qty: Q(30), planned: null },
    ]);
    expect(deliveryLines(items, new Map([["a", Q(20)]]), c)).toEqual([
      { itemId: "a", qty: Q(20), planned: Q(20) },
    ]);
  });
});

const C1 = "00000000-0000-4000-8000-000000000001";
const K = "00000000-0000-4000-8000-0000000000aa";
let seq = 0;
const newId = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;
const comp = (onHand: number, value: bigint, avg: bigint): CompState => ({
  id: C1,
  productId: K,
  mode: "stock",
  onHand: Q(onHand),
  value,
  avg,
});
const lotOf = (remaining: number): OpenLot => ({
  id: "00000000-0000-4000-a000-000000000001",
  componentId: C1,
  remaining: Q(remaining),
  receivedOn: "2026-01-01",
  expiresOn: null,
  seq: 1,
});
const sell = (qty: number): DeliveryMove => ({
  componentId: C1,
  direction: "out",
  qty: fmtQty(Q(qty)),
});
const run = (c: CompState, moves: DeliveryMove[], allowNegative?: boolean) =>
  planDelivery({
    on: "2026-11-01",
    moves,
    comps: new Map([[c.id, c]]),
    lots: c.onHand > 0n ? [lotOf(Number(c.onHand) / 10_000)] : [],
    newId,
    ...(allowNegative === undefined ? {} : { allowNegative }),
  });

describe("giao vượt tồn", () => {
  it("tắt (mặc định) ⇒ stock_insufficient, không kế hoạch", () => {
    try {
      run(comp(20, 20_000n, 1000n), [sell(50)]);
      throw new Error("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(StockError);
      expect((e as StockError).code).toBe("stock_insufficient");
    }
  });

  it("bật ⇒ tồn âm: tồn 20 bán 50 ⇒ -30, giá trị 0, lô lấy hết 20, cảnh báo vượt 30", () => {
    const p = run(comp(20, 20_000n, 1000n), [sell(50)], true);
    expect(p.result.components[0]?.onHandAfter).toBe("-30");
    expect(p.updates[0]).toMatchObject({ onHand: Q(-30), value: 0n });
    expect(p.takes).toEqual([{ lotId: lotOf(20).id, qty: Q(20) }]);
    expect(p.moves[0]?.overdrawn).toBe("30");
    expect(p.moves[0]?.amount).toBe(50_000); // 20_000 (giá trị tồn) + 30 × BQ 1000
    expect(p.result.overdrawn).toEqual([{ componentId: C1, need: "50", have: "20" }]);
    expect(overdrawNotes([{ name: "SP", need: "50", have: "20" }])).toEqual([
      "giao vượt tồn 30: SP (cần 50, còn 20)",
    ]);
  });

  it("bật nhưng đủ hàng ⇒ như cũ, không cảnh báo", () => {
    const p = run(comp(100, 100_000n, 1000n), [sell(40)], true);
    expect(p.result.overdrawn).toBeUndefined();
    expect(p.moves[0]?.overdrawn).toBeUndefined();
    expect(p.result.components[0]?.onHandAfter).toBe("60");
  });
});

describe("giao vượt tồn · tồn âm", () => {
  it("tồn đã âm bán tiếp ⇒ càng âm, không lô nào bị lấy", () => {
    const p = run(comp(-30, 0n, 1000n), [sell(10)], true);
    expect(p.result.components[0]?.onHandAfter).toBe("-40");
    expect(p.takes).toEqual([]);
    expect(p.moves[0]?.amount).toBe(10_000);
  });

  it("nhập hàng khi tồn âm ⇒ bù phần thiếu trước, chỉ phần dư thành lô còn hàng + giá trị", () => {
    const moves: DeliveryMove[] = [
      { componentId: C1, direction: "in", qty: "100", unitPrice: 2000 },
    ];
    const p = run(comp(-30, 0n, 1000n), moves);
    expect(p.result.components[0]?.onHandAfter).toBe("70");
    expect(p.lots[0]).toMatchObject({ qty: Q(100), remaining: Q(70) });
    expect(p.updates[0]).toMatchObject({ onHand: Q(70), value: 140_000n, avg: 2000n });
    // nhập chưa đủ bù ⇒ vẫn âm, lô còn 0, giá trị 0
    const q = run(comp(-30, 0n, 1000n), [{ ...moves[0], qty: "10" } as DeliveryMove]);
    expect(q.result.components[0]?.onHandAfter).toBe("-20");
    expect(q.lots[0]?.remaining).toBe(0n);
    expect(q.updates[0]).toMatchObject({ value: 0n });
  });
});
