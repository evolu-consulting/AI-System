// V2-M · đảo kho khi xoá HĐ (hàm thuần): nhập ⇒ trừ lại lô; xuất ⇒ trả thành lô mới; BQ tính lại; hàng đã bán ⇒ chặn.
import { expect, it } from "bun:test";
import { type CompState, Q, StockError } from "./stock.rules";
import { type OrigMove, planReversal } from "./stock-reversal.rules";

const comp = (onHand: bigint, value: bigint): CompState => ({
  id: "c1",
  productId: "p1",
  mode: "stock",
  onHand: onHand * Q,
  value,
  avg: onHand === 0n ? 0n : value / onHand,
});
const mv = (
  o: Partial<OrigMove> & Pick<OrigMove, "id" | "seq" | "direction" | "qty" | "amount">,
): OrigMove => ({
  componentId: "c1",
  lotId: null,
  unitCost: 0,
  contractId: "k1",
  milestoneId: null,
  contractItemId: null,
  supplierPartyKey: null,
  ...o,
});
let i = 0;
const newId = () => `n${++i}`;

it("HĐ mua: nhập 10 × 100 ⇒ đảo trừ lô, kho về 0", () => {
  const p = planReversal({
    on: "2026-10-21",
    moves: [
      mv({
        id: "m1",
        seq: 1,
        direction: "in",
        qty: "10.0000",
        amount: 1000,
        lotId: "L1",
        unitCost: 100,
      }),
    ],
    comps: new Map([["c1", comp(10n, 1000n)]]),
    lots: new Map([["L1", { id: "L1", componentId: "c1", remaining: 10n * Q }]]),
    newId,
  });
  expect(p.takes).toEqual([{ lotId: "L1", qty: 10n * Q }]);
  expect(p.moves[0]).toMatchObject({
    direction: "out",
    reason: "reversal",
    reverses: "m1",
    onHandAfter: "0",
    valueAfter: 0,
  });
  expect(p.updates[0]).toMatchObject({ onHand: 0n, value: 0n, lastMoveId: p.moves[0]?.id });
});

it("HĐ bán: xuất 4 (giá vốn 400) ⇒ trả lô mới, tồn 6 → 10, BQ tính lại", () => {
  const p = planReversal({
    on: "2026-10-21",
    moves: [mv({ id: "m2", seq: 2, direction: "out", qty: "4.0000", amount: 400, unitCost: 100 })],
    comps: new Map([["c1", comp(6n, 600n)]]),
    lots: new Map(),
    newId,
  });
  expect(p.lots).toHaveLength(1);
  expect(p.lots[0]).toMatchObject({ qty: 4n * Q, receivedOn: "2026-10-21" });
  expect(p.moves[0]).toMatchObject({
    direction: "in",
    onHandBefore: "6",
    onHandAfter: "10",
    valueAfter: 1000,
    avgAfter: 100,
  });
});

it("hàng nhập đã bán bớt (lô còn ít hơn) ⇒ stock_insufficient, không kế hoạch", () => {
  const run = () =>
    planReversal({
      on: "2026-10-21",
      moves: [mv({ id: "m1", seq: 1, direction: "in", qty: "10.0000", amount: 1000, lotId: "L1" })],
      comps: new Map([["c1", comp(3n, 300n)]]),
      lots: new Map([["L1", { id: "L1", componentId: "c1", remaining: 3n * Q }]]),
      newId,
    });
  expect(run).toThrow(StockError);
});

it("đảo theo thứ tự từ mới đến cũ: nhập 10 rồi xuất 4 ⇒ trả 4 rồi trừ 10", () => {
  const p = planReversal({
    on: "2026-10-21",
    moves: [
      mv({ id: "a", seq: 1, direction: "in", qty: "10.0000", amount: 1000, lotId: "L1" }),
      mv({ id: "b", seq: 2, direction: "out", qty: "4.0000", amount: 400 }),
    ],
    comps: new Map([["c1", comp(6n, 600n)]]),
    lots: new Map([["L1", { id: "L1", componentId: "c1", remaining: 6n * Q }]]),
    newId,
  });
  // trả 4 thành lô mới rồi rút lại khỏi lô mới khi trừ lô gốc (còn 6) ⇒ chỉ một lần trừ 6, không lô mới thừa
  expect(p.moves.map((m) => m.reverses)).toEqual(["b", "a"]);
  expect(p.takes).toEqual([{ lotId: "L1", qty: 6n * Q }]);
  expect(p.lots).toEqual([]);
  expect(p.updates[0]).toMatchObject({ onHand: 0n, value: 0n });
});

it("hàng nhập còn ở lô khác (đã trả từ lần xoá HĐ trước) ⇒ trừ tiếp từ lô đó", () => {
  const p = planReversal({
    on: "2026-10-21",
    moves: [mv({ id: "a", seq: 1, direction: "in", qty: "10.0000", amount: 1000, lotId: "L1" })],
    comps: new Map([["c1", comp(10n, 1000n)]]),
    lots: new Map([
      ["L2", { id: "L2", componentId: "c1", remaining: 4n * Q }],
      ["L1", { id: "L1", componentId: "c1", remaining: 6n * Q }],
    ]),
    newId,
  });
  expect([...p.takes].sort((a, b) => a.lotId.localeCompare(b.lotId))).toEqual([
    { lotId: "L1", qty: 6n * Q },
    { lotId: "L2", qty: 4n * Q },
  ]);
  expect(p.updates[0]).toMatchObject({ onHand: 0n, value: 0n });
});
