// gap-d1 #18 · nhập lô tay đi qua `planDelivery`: dòng sổ `manual`, BQ gia quyền giữ nguyên; chỉ chiều nhập.
import { describe, expect, it } from "bun:test";
import { type CompState, planDelivery, StockError } from "./stock.rules";

const C = "00000000-0000-4000-8000-000000000001";
const comp = (o: Partial<CompState> = {}): CompState => ({
  id: C,
  productId: "00000000-0000-4000-8000-0000000000aa",
  mode: "stock",
  onHand: 10n * 10_000n,
  value: 1_000_000n,
  avg: 100_000n,
  ...o,
});
let n = 0;
const run = (m: Record<string, unknown>, c = comp()) =>
  planDelivery({
    on: "2026-10-21",
    moves: [
      { componentId: C, direction: "in", qty: "10", unitPrice: 200_000, reason: "manual", ...m },
    ],
    comps: new Map([[C, c]]),
    lots: [],
    newId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`,
  });

describe("nhập lô tay (reason manual)", () => {
  it("sinh lô + dòng sổ manual không HĐ; giá vốn BQ gia quyền (10×100k + 10×200k)/20 = 150k", () => {
    const p = run({});
    expect(p.moves).toMatchObject([
      { reason: "manual", direction: "in", contractId: null, unitCost: 200_000 },
    ]);
    expect(p.lots).toHaveLength(1);
    expect(p.result.components[0]).toMatchObject({
      avgCostBefore: 100_000,
      avgCostAfter: 150_000,
      onHandAfter: "20",
    });
  });
  it("chỉ chiều nhập; lý do lạ bị từ chối; mặc định vẫn là delivery", () => {
    expect(() => run({ direction: "out", unitPrice: null })).toThrow(StockError);
    expect(() => run({ reason: "expire" })).toThrow(StockError);
    expect(run({ reason: undefined }).moves[0]?.reason).toBe("delivery");
  });
  it("gói suất cần hạn ≥ ngày nhập", () => {
    expect(() => run({}, comp({ mode: "quota" }))).toThrow(StockError);
    expect(run({ expiresOn: "2026-12-31" }, comp({ mode: "quota" })).lots[0]?.expiresOn).toBe(
      "2026-12-31",
    );
  });
});
