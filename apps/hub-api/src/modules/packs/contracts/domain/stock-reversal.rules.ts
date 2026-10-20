// V2-M · BA v2 6a · intake C7: xoá HĐ ⇒ kho/giá vốn BQ về như trước các lần giao — hàm THUẦN lập kế hoạch đảo các dòng sổ `delivery`
// của HĐ (từ dòng mới nhất về cũ). Nhập (HĐ mua) ⇒ trừ lại đúng lô đã nhập (phần lô gốc đã xuất trong CHÍNH HĐ này thì rút khỏi lô mới
// vừa trả; còn thiếu ⇒ chặn `stock_insufficient`, không ghi gì); xuất (HĐ bán) ⇒ trả lại thành LÔ MỚI theo đúng giá trị đã xuất (sổ xuất
// không ghi lô nguồn). Tồn/giá trị cộng trừ đúng số của dòng gốc, BQ tính lại = giá trị ÷ tồn. Thành phần `order` không giữ hàng ⇒ chỉ
// thêm dòng đảo (trước/sau rỗng). Không I/O.
import {
  avgOf,
  type CompState,
  type CompUpdate,
  fmtQty,
  type LotTake,
  type NewLot,
  parseQty,
  StockError,
} from "./stock.rules";
import type { PlannedMove } from "./stock.types";

export type OrigMove = {
  id: string;
  seq: number;
  componentId: string;
  lotId: string | null;
  direction: "in" | "out";
  qty: string;
  unitCost: number;
  amount: number;
  contractId: string | null;
  milestoneId: string | null;
  contractItemId: string | null;
  supplierPartyKey: string | null;
};
export type LotState = { id: string; remaining: bigint };
export type ReversalPlan = {
  lots: NewLot[];
  takes: LotTake[];
  moves: PlannedMove[];
  updates: CompUpdate[];
};

type Back = { lot: NewLot; mv: PlannedMove };
type Ctx = {
  on: string;
  newId: () => string;
  st: Map<string, CompState>;
  lots: Map<string, LotState>;
  plan: ReversalPlan;
  /** Lô mới đã trả (theo thành phần) — có thể bị rút lại khi đảo một lần nhập sau đó. */
  back: Map<string, Back[]>;
};

const n = (x: bigint): number => Number(x);
const tracked = (s: CompState) => s.mode === "stock" || s.mode === "quota";

/** Rút `need` khỏi các lô mới vừa trả của thành phần (mới nhất trước); lô về 0 ⇒ bỏ lô, dòng đảo tương ứng không còn lô. */
function drawBack(x: Ctx, componentId: string, need: bigint): bigint {
  let left = need;
  for (const r of [...(x.back.get(componentId) ?? [])].reverse()) {
    if (left === 0n) break;
    const t = r.lot.qty < left ? r.lot.qty : left;
    r.lot.qty -= t;
    left -= t;
    if (r.lot.qty === 0n) {
      r.mv.lotId = null;
      x.plan.lots.splice(x.plan.lots.indexOf(r.lot), 1);
      x.back.set(
        componentId,
        (x.back.get(componentId) ?? []).filter((y) => y !== r),
      );
    }
  }
  return left;
}

/** Đảo một dòng NHẬP: trừ lô gốc (+ phần đã trả); trả lô dùng cho dòng đảo. */
function reverseIn(x: Ctx, s: CompState, o: OrigMove, qty: bigint): string | null {
  const lot = o.lotId ? x.lots.get(o.lotId) : undefined;
  const amount = BigInt(o.amount);
  const t = lot && lot.remaining < qty ? lot.remaining : qty;
  const left = drawBack(x, s.id, qty - t);
  if (left > 0n || s.onHand < qty || s.value < amount)
    throw new StockError("stock_insufficient", "hàng nhập từ HĐ này đã xuất bán, không đảo được", [
      { componentId: s.id, need: fmtQty(qty), have: fmtQty(qty - left) },
    ]);
  if (lot && t > 0n) {
    lot.remaining -= t;
    x.plan.takes.push({ lotId: lot.id, qty: t });
  }
  s.onHand -= qty;
  s.value = s.onHand === 0n ? 0n : s.value - amount;
  s.avg = avgOf(s.value, s.onHand, s.avg);
  return o.lotId;
}

/** Đảo một dòng XUẤT: trả hàng thành lô mới theo giá trị đã xuất. */
function reverseOut(x: Ctx, s: CompState, o: OrigMove, qty: bigint): NewLot {
  const lot: NewLot = {
    id: x.newId(),
    componentId: s.id,
    qty,
    receivedOn: x.on,
    expiresOn: null,
  };
  x.plan.lots.push(lot);
  s.onHand += qty;
  s.value += BigInt(o.amount);
  s.avg = avgOf(s.value, s.onHand, s.avg);
  return lot;
}

type Snap = { on: string; v: number; a: number } | null;
const snapOf = (s: CompState): Snap =>
  tracked(s) ? { on: fmtQty(s.onHand), v: n(s.value), a: n(s.avg) } : null;

function moveOf(
  id: string,
  o: OrigMove,
  qty: bigint,
  at: { lotId: string | null; before: Snap; after: Snap },
): PlannedMove {
  const { lotId, before, after } = at;
  return {
    id,
    componentId: o.componentId,
    lotId,
    direction: o.direction === "in" ? "out" : "in",
    reason: "reversal",
    qty: fmtQty(qty),
    unitCost: o.unitCost,
    amount: o.amount,
    onHandBefore: before?.on ?? null,
    onHandAfter: after?.on ?? null,
    valueBefore: before?.v ?? null,
    valueAfter: after?.v ?? null,
    avgBefore: before?.a ?? null,
    avgAfter: after?.a ?? null,
    contractId: o.contractId,
    milestoneId: o.milestoneId,
    contractItemId: o.contractItemId,
    supplierPartyKey: o.supplierPartyKey,
    reverses: o.id,
  };
}

function reverseOne(x: Ctx, o: OrigMove): void {
  const s = x.st.get(o.componentId);
  if (!s) throw new StockError("invalid", `thành phần ${o.componentId} không còn`);
  const qty = parseQty(o.qty);
  if (qty === null) throw new StockError("invalid", `dòng sổ ${o.id}: số lượng sai`);
  const before = snapOf(s);
  let lotId: string | null = null;
  let returned: NewLot | null = null;
  if (tracked(s) && o.direction === "in") lotId = reverseIn(x, s, o, qty);
  else if (tracked(s)) {
    returned = reverseOut(x, s, o, qty);
    lotId = returned.id;
  }
  const mv = moveOf(x.newId(), o, qty, { lotId, before, after: snapOf(s) });
  x.plan.moves.push(mv);
  if (returned) x.back.set(s.id, [...(x.back.get(s.id) ?? []), { lot: returned, mv }]);
}

export function planReversal(input: {
  on: string;
  moves: readonly OrigMove[];
  comps: ReadonlyMap<string, CompState>;
  lots: ReadonlyMap<string, LotState>;
  newId: () => string;
}): ReversalPlan {
  const x: Ctx = {
    on: input.on,
    newId: input.newId,
    st: new Map([...input.comps].map(([id, c]) => [id, { ...c }])),
    lots: new Map([...input.lots].map(([id, l]) => [id, { ...l }])),
    plan: { lots: [], takes: [], moves: [], updates: [] },
    back: new Map(),
  };
  for (const o of [...input.moves].sort((a, b) => b.seq - a.seq)) reverseOne(x, o);
  const last = new Map<string, string>();
  for (const m of x.plan.moves) if (m.onHandAfter !== null) last.set(m.componentId, m.id);
  for (const [cid, lastMoveId] of last) {
    const s = x.st.get(cid) as CompState;
    x.plan.updates.push({ id: cid, onHand: s.onHand, value: s.value, avg: s.avg, lastMoveId });
  }
  return x.plan;
}
