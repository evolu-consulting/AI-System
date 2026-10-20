// V2-B · `applyDelivery(tx, moves, ctx)` — điểm vào ghi kho cho V2-D (xác nhận mốc giao). Tx do người gọi mở (`withPackScope`,
// role `contracts_rw`, RLS tenant + M1). Luật 4c: đúng 4 câu SQL mỗi lần giao, không phụ thuộc số dòng; văn bản cố định, dữ liệu qua
// một tham số JSON/mảng:
//   1. khoá thành phần `FOR UPDATE` theo id (thứ tự khoá cố định ⇒ không deadlock giữa hai lần giao chéo nhau);
//   2. đọc lô còn hàng/suất của các thành phần đó (index một phần `stock_lots_open_idx`);
//   — `planDelivery` (thuần) tính BQ, giá vốn, chặn vượt tồn (ném `StockError` TRƯỚC khi ghi) —
//   3. một CTE: thêm lô mới + trừ lô + thêm dòng sổ (RLS: sổ cho HĐ không thấy ⇒ 42501); lô bị trừ lọc thêm `= any(mảng id)` để kế
//      hoạch CHUNG (câu chuẩn bị sẵn) vẫn đi index khoá chính, không Seq Scan `stock_lots` (đo V2-D);
//   4. cập nhật tồn/giá trị/BQ + `last_move_id` (trigger đối chiếu dòng sổ vừa ghi).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  type CompState,
  type DeliveryCtx,
  type DeliveryMove,
  type DeliveryPlan,
  type DeliveryResult,
  type OpenLot,
  planDelivery,
  StockError,
  type StockMode,
} from "../domain/stock.rules";
import { planReversal } from "../domain/stock-reversal.rules";

export type { DeliveryCtx, DeliveryMove, DeliveryResult };
export { StockError };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pgArr = (ids: readonly string[]) => `{${ids.join(",")}}`;
const json = (v: unknown) =>
  sql`${JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}::jsonb`;

type CompRow = {
  id: string;
  product_id: string;
  mode: StockMode;
  on_hand: string;
  stock_value: string;
  avg_cost: string;
};
type LotRow = {
  id: string;
  component_id: string;
  remaining: string;
  received_on: string;
  expires_on: string | null;
  seq: string;
};

/** "12.5000" ⇒ 125000n (×10⁴). Postgres numeric(18,4) luôn có đủ 4 số lẻ hoặc không có phần lẻ. */
const scaled = (s: string): bigint => {
  const [i = "0", f = ""] = s.split(".");
  return BigInt(i) * 10_000n + BigInt(f.padEnd(4, "0").slice(0, 4));
};

export async function lockComps(tx: Tx, t: string, ids: string[]): Promise<Map<string, CompState>> {
  const rows =
    await tx.execute<CompRow>(sql`select pc.id::text, pc.product_id::text, pc.mode, pc.on_hand::text,
      pc.stock_value::text, pc.avg_cost::text
    from contracts.product_components pc
    where pc.tenant_id = ${t}::uuid and pc.id = any(${pgArr(ids)}::uuid[])
    order by pc.id for update`);
  return new Map(
    [...rows].map((r) => [
      r.id,
      {
        id: r.id,
        productId: r.product_id,
        mode: r.mode,
        onHand: scaled(r.on_hand),
        value: BigInt(r.stock_value),
        avg: BigInt(r.avg_cost),
      },
    ]),
  );
}

async function openLots(tx: Tx, t: string, ids: string[]): Promise<OpenLot[]> {
  const rows =
    await tx.execute<LotRow>(sql`select l.id::text, l.component_id::text, l.remaining::text,
      to_char(l.received_on, 'YYYY-MM-DD') as received_on, to_char(l.expires_on, 'YYYY-MM-DD') as expires_on, l.seq::text
    from contracts.stock_lots l
    where l.tenant_id = ${t}::uuid and l.component_id = any(${pgArr(ids)}::uuid[]) and l.remaining > 0`);
  return [...rows].map((r) => ({
    id: r.id,
    componentId: r.component_id,
    remaining: scaled(r.remaining),
    receivedOn: r.received_on,
    expiresOn: r.expires_on,
    seq: Number(r.seq),
  }));
}

/** Ghi kế hoạch (lô mới + trừ lô + dòng sổ, rồi tồn/BQ) — 2 câu SQL cố định; dùng chung cho giao hàng và đảo kho (V2-M). */
async function writePlan(
  tx: Tx,
  at: { t: string; on: string; ids: string[] },
  plan: Pick<DeliveryPlan, "lots" | "takes" | "moves" | "updates">,
): Promise<void> {
  const { t, on, ids } = at;
  const w = {
    lots: plan.lots,
    takes: plan.takes,
    moves: plan.moves.map((m, ord) => ({ ...m, ord })),
  };
  await tx.execute(sql`with p as (select ${json(w)} as j),
    nl as (
      insert into contracts.stock_lots (id, tenant_id, component_id, qty, remaining, received_on, expires_on)
      select x.id, ${t}::uuid, x."componentId", x.qty::numeric / 10000, x.qty::numeric / 10000, x."receivedOn", x."expiresOn"
      from p, jsonb_to_recordset(p.j -> 'lots') as x(id uuid, "componentId" uuid, qty bigint, "receivedOn" date, "expiresOn" date)
      returning id),
    tk as (
      update contracts.stock_lots l set remaining = l.remaining - x.q
      from (select y."lotId" as id, sum(y.qty)::numeric / 10000 as q
            from p, jsonb_to_recordset(p.j -> 'takes') as y("lotId" uuid, qty bigint) group by y."lotId") x
      where l.tenant_id = ${t}::uuid and l.id = x.id
        and l.id = any (${pgArr([...new Set(plan.takes.map((k) => k.lotId))])}::uuid[])
      returning l.id)
    insert into contracts.stock_moves (id, tenant_id, component_id, lot_id, direction, reason, qty, unit_cost, amount,
      on_hand_before, on_hand_after, value_before, value_after, avg_before, avg_after, moved_on, contract_id, milestone_id,
      contract_item_id, supplier_party_key, reverses)
    select m.id, ${t}::uuid, m."componentId", m."lotId", m.direction, m.reason, m.qty, m."unitCost", m.amount,
      m."onHandBefore", m."onHandAfter", m."valueBefore", m."valueAfter", m."avgBefore", m."avgAfter", ${on}::date,
      m."contractId", m."milestoneId", m."contractItemId", m."supplierPartyKey", m.reverses
    from p, jsonb_to_recordset(p.j -> 'moves') as m(id uuid, "componentId" uuid, "lotId" uuid, direction text,
      reason text, qty numeric, "unitCost" bigint, amount bigint, "onHandBefore" numeric, "onHandAfter" numeric,
      "valueBefore" bigint, "valueAfter" bigint, "avgBefore" bigint, "avgAfter" bigint, "contractId" uuid, "milestoneId" uuid,
      "contractItemId" uuid, "supplierPartyKey" text, reverses uuid, ord bigint)
    order by m.ord`);
  await tx.execute(sql`update contracts.product_components pc
    set on_hand = u."onHand"::numeric / 10000, stock_value = u.value, avg_cost = u.avg, last_move_id = u."lastMoveId",
      updated_at = now()
    from jsonb_to_recordset(${json(plan.updates)}) as u(id uuid, "onHand" bigint, value bigint, avg bigint, "lastMoveId" uuid)
    where pc.tenant_id = ${t}::uuid and pc.id = any(${pgArr(ids)}::uuid[]) and pc.id = u.id`);
}

/**
 * Ghi một lần giao (nhập HĐ mua / xuất HĐ bán) theo tập. Ném `StockError` (`invalid` | `stock_insufficient`, kèm từng thành phần
 * thiếu) mà KHÔNG ghi gì; người gọi huỷ tx. Trả kho + giá vốn trước → sau từng thành phần và các dòng sổ đã ghi.
 */
export async function applyDelivery(
  tx: Tx,
  moves: readonly DeliveryMove[],
  ctx: DeliveryCtx,
): Promise<DeliveryResult> {
  const t = ctx.tenantId;
  const ids = [
    ...new Set(
      moves.map((m) => m.componentId).filter((id) => typeof id === "string" && UUID.test(id)),
    ),
  ].sort();
  const comps = await lockComps(tx, t, ids);
  const lots = await openLots(tx, t, ids);
  const plan = planDelivery({ on: ctx.on, moves, comps, lots, newId: () => crypto.randomUUID() });
  await writePlan(tx, { t, on: ctx.on, ids }, plan);
  return plan.result;
}

type OrigRow = {
  id: string;
  seq: string;
  component_id: string;
  lot_id: string | null;
  direction: "in" | "out";
  qty: string;
  unit_cost: string;
  amount: string;
  contract_id: string | null;
  milestone_id: string | null;
  contract_item_id: string | null;
  supplier_party_key: string | null;
};

const origOf = (r: OrigRow) => ({
  id: r.id,
  seq: Number(r.seq),
  componentId: r.component_id,
  lotId: r.lot_id,
  direction: r.direction,
  qty: r.qty,
  unitCost: Number(r.unit_cost),
  amount: Number(r.amount),
  contractId: r.contract_id,
  milestoneId: r.milestone_id,
  contractItemId: r.contract_item_id,
  supplierPartyKey: r.supplier_party_key,
});
/**
 * V2-M · đảo kho của MỘT HĐ trước khi xoá (cùng tx): mọi dòng sổ `delivery` chưa đảo ⇒ dòng `reversal` + trả/trừ lô + tồn/BQ tính
 * lại (`planReversal`). Số câu SQL cố định (khoá, đọc dòng, đọc lô, 2 câu ghi). Thiếu hàng để trừ ⇒ `StockError` TRƯỚC khi ghi.
 * Trả số dòng đã đảo.
 */
export async function reverseContractStock(
  tx: Tx,
  t: string,
  contractId: string,
  on: string,
): Promise<number> {
  const rows =
    await tx.execute<OrigRow>(sql`select m.id::text, m.seq::text, m.component_id::text, m.lot_id::text, m.direction,
      m.qty::text, m.unit_cost::text, m.amount::text, m.contract_id::text, m.milestone_id::text, m.contract_item_id::text,
      m.supplier_party_key
    from contracts.stock_moves m
    where m.tenant_id = ${t}::uuid and m.contract_id = ${contractId}::uuid and m.reason = 'delivery'
      and not exists (select 1 from contracts.stock_moves r where r.tenant_id = m.tenant_id and r.reverses = m.id)`);
  const orig = [...rows];
  if (orig.length === 0) return 0;
  const ids = [...new Set(orig.map((r) => r.component_id))].sort();
  const comps = await lockComps(tx, t, ids);
  const lotIds = [...new Set(orig.map((r) => r.lot_id).filter((x): x is string => x !== null))];
  const lotRows = await tx.execute<{
    id: string;
    component_id: string;
    remaining: string;
  }>(sql`select l.id::text, l.component_id::text, l.remaining::text
    from contracts.stock_lots l where l.tenant_id = ${t}::uuid
      and (l.id = any(${pgArr(lotIds)}::uuid[]) or (l.component_id = any(${pgArr(ids)}::uuid[]) and l.remaining > 0))
    order by l.seq desc`);
  const lots = new Map(
    [...lotRows].map((l) => [
      l.id,
      { id: l.id, componentId: l.component_id, remaining: scaled(l.remaining) },
    ]),
  );
  const plan = planReversal({
    on,
    moves: orig.map(origOf),
    comps,
    lots,
    newId: () => crypto.randomUUID(),
  });
  await writePlan(tx, { t, on, ids }, plan);
  return plan.moves.length;
}
