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
  type DeliveryResult,
  type OpenLot,
  planDelivery,
  StockError,
  type StockMode,
} from "../domain/stock.rules";

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

async function lockComps(tx: Tx, t: string, ids: string[]): Promise<Map<string, CompState>> {
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
      contract_item_id, supplier_party_key)
    select m.id, ${t}::uuid, m."componentId", m."lotId", m.direction, m.reason, m.qty, m."unitCost", m.amount,
      m."onHandBefore", m."onHandAfter", m."valueBefore", m."valueAfter", m."avgBefore", m."avgAfter", ${ctx.on}::date,
      m."contractId", m."milestoneId", m."contractItemId", m."supplierPartyKey"
    from p, jsonb_to_recordset(p.j -> 'moves') as m(id uuid, "componentId" uuid, "lotId" uuid, direction text,
      reason text, qty numeric, "unitCost" bigint, amount bigint, "onHandBefore" numeric, "onHandAfter" numeric,
      "valueBefore" bigint, "valueAfter" bigint, "avgBefore" bigint, "avgAfter" bigint, "contractId" uuid, "milestoneId" uuid,
      "contractItemId" uuid, "supplierPartyKey" text, ord bigint)
    order by m.ord`);
  await tx.execute(sql`update contracts.product_components pc
    set on_hand = u."onHand"::numeric / 10000, stock_value = u.value, avg_cost = u.avg, last_move_id = u."lastMoveId",
      updated_at = now()
    from jsonb_to_recordset(${json(plan.updates)}) as u(id uuid, "onHand" bigint, value bigint, avg bigint, "lastMoveId" uuid)
    where pc.tenant_id = ${t}::uuid and pc.id = any(${pgArr(ids)}::uuid[]) and pc.id = u.id`);
  return plan.result;
}
