// V2-O · sổ kho / lô / giá vốn BQ của bộ mẫu v2 (thuần). Mốc GIAO đã làm: HĐ mua ⇒ nhập một lô (BQ gia quyền = (tồn cũ × giá cũ + lô × giá) /
// tổng tồn, BA 5.3a); HĐ bán ⇒ xuất theo BQ lúc bán (5.3b), trừ lô sớm hết hạn/nhập trước. Dịch vụ có hạn: lô hết hạn = ngày kết thúc HĐ.
import {
  type Actors,
  partyKeyOf,
  productOf,
  type Row,
  shiftOf,
  uid,
  vnDate,
} from "./seed-demo-v2.build";
import { CONTRACTS } from "./seed-demo-v2.contracts";
import type { ContractSpec } from "./seed-demo-v2.specs";

type Comp = { onHand: number; value: number; avg: number; lastMove: string | null };
type Lot = {
  id: string;
  comp: string;
  seq: number;
  qty: number;
  remaining: number;
  received: string;
  expires: string | null;
};
export type StockPlan = { lots: Row[]; moves: Row[]; comps: Map<string, Comp> };

type Ev = { c: ContractSpec; ms: string; item: string; product: string; qty: number; date: string };

function deliveries(shift: number): Ev[] {
  const out: Ev[] = [];
  for (const c of CONTRACTS)
    for (const m of c.ms)
      if (m.kind === "delivery" && m.done)
        for (const [item, qty] of m.items ?? []) {
          const product = c.items.find((i) => i.key === item)?.product ?? "";
          out.push({ c, ms: m.key, item, product, qty, date: vnDate(m.done, shift) });
        }
  return out.sort(
    (x, y) => x.date.localeCompare(y.date) || CONTRACTS.indexOf(x.c) - CONTRACTS.indexOf(y.c),
  );
}

const round = Math.round;
/** Trừ lô: sớm hết hạn trước, rồi nhập trước. Trả lô đầu tiên bị trừ. */
function take(lots: Lot[], comp: string, qty: number): Lot | undefined {
  const open = lots
    .filter((l) => l.comp === comp && l.remaining > 0)
    .sort((a, b) => (a.expires ?? "9").localeCompare(b.expires ?? "9") || a.seq - b.seq);
  let left = qty;
  for (const l of open) {
    const n = Math.min(l.remaining, left);
    l.remaining -= n;
    left -= n;
  }
  return open[0];
}

function newLot(e: Ev, comp: string, seq: number, shift: number): Lot {
  const service = productOf(e.product).grp === "service";
  return {
    id: uid("lot", `${e.c.key}:${e.ms}:${e.item}`),
    comp,
    seq,
    qty: e.qty,
    remaining: e.qty,
    received: e.date,
    expires: service ? vnDate(e.c.end, shift) : null,
  };
}

/** Giá nhập = giá dòng HĐ mua; xuất = BQ lúc bán. Trả [đơn giá, thành tiền, tồn sau, giá trị sau]. */
function price(e: Ev, st: Comp, buy: boolean): [number, number, number, number] {
  const unit = buy ? (e.c.items.find((i) => i.key === e.item)?.price ?? 0) : st.avg;
  const amount = round(e.qty * unit);
  const after = buy ? st.onHand + e.qty : st.onHand - e.qty;
  const keep = Math.max(0, st.value - amount);
  return [unit, amount, after, buy ? st.value + amount : after === 0 ? 0 : keep];
}

function moveRow(e: Ev, st: Comp, lot: Lot | undefined, ctx: { a: Actors; tenant: string }): Row {
  const buy = e.c.deal === "buy";
  const [unit, amount, after, valueAfter] = price(e, st, buy);
  return {
    id: uid("move", `${e.c.key}:${e.ms}:${e.item}`),
    tenant_id: ctx.tenant,
    component_id: uid("comp", e.product),
    lot_id: lot?.id ?? null,
    direction: buy ? "in" : "out",
    reason: "delivery",
    qty: e.qty,
    unit_cost: unit,
    amount,
    on_hand_before: st.onHand,
    on_hand_after: after,
    value_before: st.value,
    value_after: valueAfter,
    avg_before: st.avg,
    avg_after: after > 0 ? round(valueAfter / after) : 0,
    moved_on: e.date,
    contract_id: uid("contract", e.c.key),
    milestone_id: uid("ms", `${e.c.key}:${e.ms}`),
    contract_item_id: uid("item", `${e.c.key}:${e.item}`),
    supplier_party_key: buy ? partyKeyOf(e.c.partner) : null,
    created_by: ctx.a.owner,
  };
}

export function stockPlan(a: Actors, tenant: string, today: string): StockPlan {
  const shift = shiftOf(today);
  const comps = new Map<string, Comp>();
  const lots: Lot[] = [];
  const moves: Row[] = [];
  for (const e of deliveries(shift)) {
    const comp = uid("comp", e.product);
    const st = comps.get(comp) ?? { onHand: 0, value: 0, avg: 0, lastMove: null };
    const lot =
      e.c.deal === "buy" ? newLot(e, comp, lots.length + 1, shift) : take(lots, comp, e.qty);
    if (e.c.deal === "buy" && lot) lots.push(lot);
    const m = moveRow(e, st, lot, { a, tenant });
    moves.push(m);
    comps.set(comp, {
      onHand: m.on_hand_after as number,
      value: m.value_after as number,
      avg: m.avg_after as number,
      lastMove: m.id as string,
    });
  }
  return { lots: lots.map((l) => lotRow(l, tenant)), moves, comps };
}

const lotRow = (l: Lot, tenant: string): Row => ({
  id: l.id,
  tenant_id: tenant,
  component_id: l.comp,
  qty: l.qty,
  remaining: l.remaining,
  received_on: l.received,
  expires_on: l.expires,
});
