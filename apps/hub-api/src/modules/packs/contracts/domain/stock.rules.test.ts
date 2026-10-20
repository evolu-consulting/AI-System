// V2-B · BA §5.3 / §5.7: hàm thuần `planDelivery` (BQ gia quyền, giá vốn xuất, chặn vượt tồn, gói suất có hạn, không giữ hàng).
import { describe, expect, it } from "bun:test";
import {
  amountOf,
  type CompState,
  costOut,
  type DeliveryMove,
  fmtQty,
  type OpenLot,
  parseQty,
  planDelivery,
  StockError,
} from "./stock.rules";

const C1 = "00000000-0000-4000-8000-000000000001";
const C2 = "00000000-0000-4000-8000-000000000002";
const K = "00000000-0000-4000-8000-0000000000aa";
let seq = 0;
const newId = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;
const comp = (
  id: string,
  mode: CompState["mode"],
  onHand = 0n,
  value = 0n,
  avg = 0n,
): CompState => ({
  id,
  productId: K,
  mode,
  onHand: onHand * 10_000n,
  value,
  avg,
});
const plan = (
  comps: CompState[],
  moves: DeliveryMove[],
  o: { on?: string; lots?: OpenLot[] } = {},
) =>
  planDelivery({
    on: o.on ?? "2026-11-01",
    moves,
    comps: new Map(comps.map((c) => [c.id, c])),
    lots: o.lots ?? [],
    newId,
  });
const lot = (
  id: string,
  componentId: string,
  remaining: number,
  receivedOn: string,
  expiresOn: string | null = null,
  s = 1,
): OpenLot => ({
  id,
  componentId,
  remaining: BigInt(remaining) * 10_000n,
  receivedOn,
  expiresOn,
  seq: s,
});
const lcg = (seed: number) => {
  let r = seed;
  return (m: number) => {
    r = (r * 48_271) % 2_147_483_647;
    return r % m;
  };
};
/** Bán (2/3, có lúc bán hết) khi còn hàng, ngược lại nhập lô giá ngẫu nhiên. */
function randomMove(st: CompState, rnd: (m: number) => number): DeliveryMove {
  const onHand = Number(st.onHand) / 10_000;
  if (onHand === 0 || rnd(3) === 0) {
    const qty = fmtQty(BigInt(rnd(99_990) + 1) * 100n);
    return { componentId: C1, direction: "in", qty, unitPrice: rnd(1_000_000) + 1 };
  }
  const q = Math.max(0.0001, Math.min(onHand, (rnd(5000) + 1) / 100));
  const qty = rnd(10) === 0 ? fmtQty(st.onHand) : fmtQty(BigInt(Math.round(q * 10_000)));
  return { componentId: C1, direction: "out", qty };
}
function nextLots(lots: OpenLot[], p: ReturnType<typeof plan>, i: number): OpenLot[] {
  const taken = new Map<string, bigint>();
  for (const t of p.takes) taken.set(t.lotId, (taken.get(t.lotId) ?? 0n) + t.qty);
  const fresh = p.lots.map((l, k) => ({
    id: l.id,
    componentId: C1,
    remaining: l.qty,
    receivedOn: "2026-11-01",
    expiresOn: null,
    seq: i * 10 + k,
  }));
  return [
    ...lots.map((l) => ({ ...l, remaining: l.remaining - (taken.get(l.id) ?? 0n) })),
    ...fresh,
  ].filter((l) => l.remaining > 0n);
}
const err = (fn: () => unknown): StockError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof StockError) return e;
    throw e;
  }
  throw new Error("không ném");
};

describe("số học", () => {
  it("SL ×10⁴: đọc/ghi, từ chối ≤ 0, > 4 số lẻ, chữ", () => {
    expect([parseQty("150"), parseQty("2.5"), parseQty("0.0001")]).toEqual([
      1_500_000n,
      25_000n,
      1n,
    ]);
    expect([
      parseQty("0"),
      parseQty("-1"),
      parseQty("1.00001"),
      parseQty("x"),
      parseQty(5),
    ]).toEqual([null, null, null, null, null]);
    expect([fmtQty(1_500_000n), fmtQty(25_000n), fmtQty(3_333n), fmtQty(0n)]).toEqual([
      "150",
      "2.5",
      "0.3333",
      "0",
    ]);
  });
  it("thành tiền + giá vốn xuất làm tròn nửa lên; xuất hết = giá trị còn", () => {
    expect(amountOf(25_000n, 33_333n)).toBe(83_333n);
    expect(costOut(1_500_000n, 6_200_000n, 6_800_000n)).toBe(1_645_161n);
    expect(costOut(6_200_000n, 6_200_000n, 6_800_001n)).toBe(6_800_001n);
  });
});

describe("planDelivery · nhập/xuất", () => {
  it("BA 5.3a: 320 × 10.000 + 300 × 12.000 ⇒ BQ 10.968; dòng nhập tạo lô, cập nhật trỏ dòng sổ cuối", () => {
    const p = plan(
      [comp(C1, "stock", 320n, 3_200_000n, 10_000n)],
      [{ componentId: C1, direction: "in", qty: "300", unitPrice: 12_000 }],
    );
    expect(p.result.components[0]).toMatchObject({
      onHandBefore: "320",
      onHandAfter: "620",
      avgCostAfter: 10_968,
      valueAfter: 6_800_000,
    });
    expect(p.lots).toHaveLength(1);
    expect(p.updates).toEqual([
      {
        id: C1,
        onHand: 6_200_000n,
        value: 6_800_000n,
        avg: 10_968n,
        lastMoveId: p.moves[0]?.id as string,
      },
    ]);
    expect(p.moves[0]).toMatchObject({
      lotId: p.lots[0]?.id,
      unitCost: 12_000,
      amount: 3_600_000,
      onHandBefore: "320",
      onHandAfter: "620",
    });
  });

  it("xuất FIFO theo lô, BQ không đổi; hai dòng cùng thành phần cộng dồn, cập nhật một lần", () => {
    const lots = [
      lot("L2", C1, 300, "2026-02-01", null, 2),
      lot("L1", C1, 20, "2026-01-01", null, 1),
    ];
    const p = plan(
      [comp(C1, "stock", 320n, 6_800_000n, 21_250n)],
      [
        { componentId: C1, direction: "out", qty: "50" },
        { componentId: C1, direction: "out", qty: "10" },
      ],
      { lots },
    );
    expect(p.takes).toEqual([
      { lotId: "L1", qty: 200_000n },
      { lotId: "L2", qty: 300_000n },
      { lotId: "L2", qty: 100_000n },
    ]);
    expect(p.updates).toHaveLength(1);
    expect(p.result.components[0]).toMatchObject({ onHandAfter: "260", avgCostAfter: 21_250 });
  });

  it("vượt tồn ⇒ stock_insufficient báo MỌI thành phần thiếu, theo tổng cộng dồn", () => {
    const e = err(() =>
      plan(
        [comp(C1, "stock", 5n, 50n, 10n), comp(C2, "stock", 1n, 10n, 10n)],
        [
          { componentId: C1, direction: "out", qty: "3" },
          { componentId: C1, direction: "out", qty: "3" },
          { componentId: C2, direction: "out", qty: "2" },
        ],
        { lots: [lot("a", C1, 5, "2026-01-01"), lot("b", C2, 1, "2026-01-01")] },
      ),
    );
    expect([e.code, e.shortages]).toEqual([
      "stock_insufficient",
      [
        { componentId: C1, need: "6", have: "5" },
        { componentId: C2, need: "2", have: "1" },
      ],
    ]);
  });

  it("bảo toàn tiền: chuỗi nhập/xuất ngẫu nhiên ⇒ Σ nhập = Σ xuất + giá trị còn, tồn = Σ lô còn", () => {
    let st = comp(C1, "stock");
    let lots: OpenLot[] = [];
    let net = 0;
    const rnd = lcg(7);
    for (let i = 0; i < 300; i++) {
      const p = plan([st], [randomMove(st, rnd)], { lots });
      net += p.moves.reduce((s, mv) => s + (mv.direction === "in" ? mv.amount : -mv.amount), 0);
      const u = p.updates[0] as { onHand: bigint; value: bigint; avg: bigint };
      st = { ...st, onHand: u.onHand, value: u.value, avg: u.avg };
      lots = nextLots(lots, p, i);
      expect(net).toBe(Number(st.value));
      expect(lots.reduce((s, l) => s + l.remaining, 0n)).toBe(st.onHand);
      expect(st.onHand > 0n || st.value === 0n).toBe(true);
    }
  });
});

describe("planDelivery · gói suất có hạn, không giữ hàng, kiểm dòng", () => {
  it("gói quá hạn ⇒ dòng expire theo BQ trước; bán trừ gói hết hạn sớm nhất", () => {
    const lots = [
      lot("late", C1, 50, "2026-07-01", "2027-06-30", 2),
      lot("early", C1, 70, "2026-01-10", "2026-12-31", 1),
    ];
    const p = plan(
      [comp(C1, "quota", 120n, 26_400_000n, 220_000n)],
      [{ componentId: C1, direction: "out", qty: "10" }],
      {
        on: "2027-01-05",
        lots,
      },
    );
    expect(p.moves.map((m) => [m.reason, m.lotId, m.qty, m.amount])).toEqual([
      ["expire", "early", "70", 15_400_000],
      ["delivery", null, "10", 2_200_000],
    ]);
    expect(p.takes).toEqual([
      { lotId: "early", qty: 700_000n },
      { lotId: "late", qty: 100_000n },
    ]);
  });

  it("thành phần order: giá vốn theo đơn, không tồn, không cập nhật", () => {
    const p = plan(
      [comp(C1, "order")],
      [{ componentId: C1, direction: "out", qty: "2", unitPrice: 450_000 }],
    );
    expect(p.moves[0]).toMatchObject({ amount: 900_000, onHandBefore: null, onHandAfter: null });
    expect(p.updates).toEqual([]);
  });

  it("dòng sai ⇒ invalid", () => {
    const g = comp(C1, "stock", 10n, 100n, 10n);
    const cases: [CompState[], DeliveryMove[]][] = [
      [[g], [{ componentId: C2, direction: "in", qty: "1", unitPrice: 1 }]],
      [[comp(C1, "none")], [{ componentId: C1, direction: "in", qty: "1", unitPrice: 1 }]],
      [[g], [{ componentId: C1, direction: "in", qty: "1" }]],
      [[g], [{ componentId: C1, direction: "out", qty: "1", unitPrice: 5 }]],
      [[g], [{ componentId: C1, direction: "in", qty: "1", unitPrice: -1 }]],
      [[g], [{ componentId: C1, direction: "in", qty: "1", unitPrice: 1.5 }]],
      [
        [g],
        [{ componentId: C1, direction: "in", qty: "1", unitPrice: 1, expiresOn: "2027-01-01" }],
      ],
      [
        [comp(C1, "quota")],
        [{ componentId: C1, direction: "in", qty: "1", unitPrice: 1, expiresOn: "2026-10-01" }],
      ],
      [[comp(C1, "order")], [{ componentId: C1, direction: "out", qty: "1" }]],
      [
        [g],
        [
          { componentId: C1, direction: "in", qty: "1", unitPrice: 1 },
          { componentId: C1, direction: "out", qty: "1" },
        ],
      ],
      [[g], [{ componentId: C1, direction: "in", qty: "1", unitPrice: 1, contractId: "x" }]],
      [
        [g],
        [
          {
            componentId: C1,
            direction: "in",
            qty: "100000000000000",
            unitPrice: 1_000_000_000_000_000,
          },
        ],
      ],
      [[g], []],
    ];
    for (const [cs, ms] of cases) expect(err(() => plan(cs, ms)).code).toBe("invalid");
    expect(
      err(() => plan([g], [{ componentId: C1, direction: "out", qty: "1" }], { on: "2026-13-45" }))
        .code,
    ).toBe("invalid");
  });
});
