// V2-D · HD-05 · BA §5.7a-d · §5.3b: xác nhận mốc giao ⇒ kho (gọi trong tx của `settle`, cùng khoá HĐ → mốc), bảng Trên HĐ · Đã giao ·
// Giao lần này, kiểm tồn khi lưu HĐ bán (cảnh báo, không chặn). Lớp 2: không SQL — luật ở `domain/delivery.rules.ts`.

import type { PackUow, PackWho } from "../../kit/application/ports";
import {
  checkPlan,
  type DComp,
  type DCtx,
  DeliveryError,
  type DItem,
  deliveryLines,
  deliveryMoves,
  qtyIn,
  qtyOf,
  stockNotes,
} from "../domain/delivery.rules";
import type {
  DeliveryOutcome,
  DeliveryView,
  StockCheckOut,
  StockCheckRequest,
} from "../domain/delivery.types";
import { type DeliveryResult, fmtQty, StockError } from "../domain/stock.rules";
import {
  DeliveryFail,
  type DeliveryItemRow,
  type DeliveryLoad,
  type DeliveryRepo,
} from "./delivery.ports";

const toItem = (r: DeliveryItemRow): DItem => ({
  id: r.id,
  name: r.name,
  qty: qtyOf(r.qty),
  unitPrice: r.unit_price === null ? null : Number(r.unit_price),
  productId: r.product_id,
  componentIds: r.component_ids,
  delivered: qtyOf(r.delivered) ?? 0n,
});
const ctxOf = (L: DeliveryLoad, milestoneId: string): DCtx => ({
  deal: L.deal,
  contractId: L.contract_id,
  milestoneId,
  endDate: L.end_date,
  supplierKey: L.supplier,
  milestoneQty: qtyOf(L.qty),
});
const compsOf = (L: DeliveryLoad): DComp[] =>
  L.comps.map((x) => ({
    id: x.id,
    productId: x.product_id,
    name: x.name,
    mode: x.mode,
    ord: x.ord,
  }));

const failOf = (e: unknown): never => {
  if (e instanceof DeliveryError) throw new DeliveryFail(e.code, e.detail);
  throw e;
};

/** SL ghi cùng câu xác nhận (dòng 0 của bảng SL cũng ghi để giữ trạng thái đã xác nhận). */
export type DeliveredRow = { item_id: string; qty: string; planned: string | null };
export type Confirmed = { rows: DeliveredRow[]; outcome: DeliveryOutcome | null };

/** Trong tx `settle`, SAU khi đã khoá HĐ + mốc. Ném `DeliveryFail` (không ghi gì — người gọi huỷ tx). */
export async function confirmDelivery(
  r: DeliveryRepo,
  milestoneId: string,
  on: string,
): Promise<Confirmed> {
  const L = await r.load(milestoneId);
  if (!L) throw new DeliveryFail("not_found");
  const items = L.items.map(toItem);
  const plan = new Map(L.plan.map((p) => [p.item_id, qtyOf(p.qty)]));
  const ctx = ctxOf(L, milestoneId);
  const comps = compsOf(L);
  let lines: ReturnType<typeof deliveryLines> = [];
  let moves: ReturnType<typeof deliveryMoves> = [];
  try {
    lines = deliveryLines(items, plan, ctx);
    moves = deliveryMoves(lines, items, comps, ctx);
  } catch (e) {
    failOf(e);
  }
  const rows = lines.map((l) => ({
    item_id: l.itemId,
    qty: fmtQty(l.qty),
    planned: l.planned === null ? null : fmtQty(l.planned),
  }));
  const given = rows.filter((x) => x.qty !== "0").map(({ item_id, qty }) => ({ item_id, qty }));
  if (given.length === 0) return { rows, outcome: null };
  const res = moves.length ? await applied(r, moves, on, comps) : null;
  return { rows, outcome: outcomeOf(given, res?.components ?? [], comps) };
}

/** BA 5.7d: kho + giá vốn trước → sau theo thành phần (kèm tên) + câu thông báo. */
function outcomeOf(
  items: DeliveryOutcome["items"],
  changes: DeliveryResult["components"],
  comps: DComp[],
): DeliveryOutcome {
  const named = changes.map((x) => ({
    ...x,
    name: comps.find((y) => y.id === x.componentId)?.name ?? "",
  }));
  return {
    items,
    stock: named.map((x) => ({
      component_id: x.componentId,
      product_id: x.productId,
      name: x.name,
      mode: x.mode,
      on_hand_before: x.onHandBefore,
      on_hand_after: x.onHandAfter,
      avg_cost_before: x.avgCostBefore,
      avg_cost_after: x.avgCostAfter,
    })),
    notes: stockNotes(named),
  };
}

async function applied(
  r: DeliveryRepo,
  moves: Parameters<DeliveryRepo["apply"]>[0],
  on: string,
  comps: DComp[],
) {
  try {
    return await r.apply(moves, on);
  } catch (e) {
    if (!(e instanceof StockError)) throw e;
    if (e.code !== "stock_insufficient") throw new DeliveryFail("invalid", e.detail);
    const shortages = e.shortages.map((s) => ({
      component_id: s.componentId,
      name: comps.find((x) => x.id === s.componentId)?.name ?? "",
      need: s.need,
      have: s.have,
    }));
    const text = shortages.map((s) => `${s.name} cần ${s.need}, còn ${s.have}`).join("; ");
    throw new DeliveryFail("insufficient", `Không đủ tồn: ${text}`, shortages);
  }
}

/** Lưu mốc: kiểm bảng SL với dòng HĐ + đã giao. `invalid` (dòng lạ/trùng) | `over` (vượt phần còn lại). */
export async function checkMilestonePlan(
  r: DeliveryRepo,
  contractId: string,
  plan: readonly { item_id: string; qty: number | null }[],
): Promise<{ item_id: string; qty: string | null }[]> {
  const items = (await r.contractItems(contractId)).map(toItem);
  const rows = plan.map((p) => ({ itemId: p.item_id, qty: p.qty === null ? null : qtyIn(p.qty) }));
  const bad = checkPlan(items, rows);
  if (bad) throw new DeliveryFail(bad.code, bad.detail);
  return rows.map((p) => ({ item_id: p.itemId, qty: p.qty === null ? null : fmtQty(p.qty) }));
}

/** Bảng Trên HĐ · Đã giao · Giao lần này của một mốc (mốc đã xác nhận: lần này = SL đã giao ở mốc). */
export function viewOf(L: DeliveryLoad, milestoneId: string): DeliveryView {
  const items = L.items.map(toItem);
  const own = new Map(L.plan.map((p) => [p.item_id, p]));
  const done = L.status === "done";
  const lines = done ? [] : safeLines(items, L, milestoneId);
  const rows = items.map((i) => {
    const mine = own.get(i.id);
    const ownDelivered = done ? (qtyOf(mine?.delivered ?? null) ?? 0n) : 0n;
    const before = i.delivered - ownDelivered;
    const now = done ? ownDelivered : (lines.find((l) => l.itemId === i.id)?.qty ?? 0n);
    const src = L.items.find((x) => x.id === i.id) as DeliveryItemRow;
    return {
      item_id: i.id,
      name: i.name,
      unit: src.unit,
      product_id: i.productId,
      on_contract: i.qty === null ? null : fmtQty(i.qty),
      delivered: fmtQty(before),
      this_time: fmtQty(now),
      remaining: i.qty === null ? null : fmtQty(i.qty - before),
    };
  });
  return { milestone_id: milestoneId, status: L.status, rows };
}

/** Như lúc xác nhận nhưng không ném: SL vượt vẫn hiện (người dùng sửa trước khi xác nhận). */
function safeLines(items: DItem[], L: DeliveryLoad, milestoneId: string) {
  const plan = new Map(L.plan.map((p) => [p.item_id, qtyOf(p.qty)]));
  try {
    return deliveryLines(items, plan, ctxOf(L, milestoneId));
  } catch {
    return items
      .filter((i) => plan.has(i.id))
      .map((i) => ({ itemId: i.id, qty: plan.get(i.id) ?? 0n, planned: plan.get(i.id) ?? null }));
  }
}

/** BA 5.7b/e: tổng SL bán theo thành phần giữ hàng so với tồn — cờ cảnh báo, không chặn lưu. SP lạ ⇒ `not_found`. */
export function stockCheckOf(
  b: StockCheckRequest,
  stock: Awaited<ReturnType<DeliveryRepo["stockOf"]>>,
): StockCheckOut {
  const need = new Map<string, bigint>();
  for (const it of b.items) {
    const own = stock.filter((s) => s.product_id === it.product_id);
    if (own.length === 0) throw new DeliveryFail("not_found");
    const picked = it.component_ids?.length
      ? own.filter((s) => it.component_ids?.includes(s.id))
      : own;
    if (picked.length !== (it.component_ids?.length || own.length))
      throw new DeliveryFail("invalid", "thành phần không thuộc SP");
    for (const s of picked)
      if (s.mode === "stock" || s.mode === "quota")
        need.set(s.id, (need.get(s.id) ?? 0n) + qtyIn(it.qty));
  }
  const components = [...need].map(([id, q]) => {
    const s = stock.find((x) => x.id === id) as (typeof stock)[number];
    const have = qtyOf(s.on_hand) ?? 0n;
    return {
      component_id: id,
      product_id: s.product_id,
      name: s.name,
      mode: s.mode as "stock" | "quota",
      need: fmtQty(q),
      on_hand: fmtQty(have),
      over: q > have,
    };
  });
  return { over_stock: components.some((x) => x.over), components };
}

export function deliveryReads(d: { uow: PackUow<{ delivery: DeliveryRepo }> }) {
  return {
    view: (who: PackWho, milestoneId: string) =>
      d.uow.tenant(who, async ({ delivery: r }) => {
        const L = await r.load(milestoneId);
        if (L?.kind !== "delivery") throw new DeliveryFail("not_found");
        return viewOf(L, milestoneId);
      }),
    stockCheck: (who: PackWho, b: StockCheckRequest) =>
      d.uow.tenant(who, async ({ delivery: r }) =>
        stockCheckOf(b, await r.stockOf([...new Set(b.items.map((i) => i.product_id))])),
      ),
  };
}
export type DeliveryReads = ReturnType<typeof deliveryReads>;
