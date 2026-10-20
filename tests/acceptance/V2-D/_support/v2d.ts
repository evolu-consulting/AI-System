// V2-D · hạ tầng int: như V2-A (DB sạch, hub-api THẬT in-process; HĐ dựng bằng owner qua `deal()` của HD7) + SP/thành phần + dòng
// HĐ gắn SP (owner, bỏ RLS). Xác nhận mốc giao = `POST /obligations/:id/settle` THẬT. Đỏ NGAY nếu thiếu migration 0026.
// Không chứa `it(...)`.
import { expect } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  deal,
  type Json,
  ok,
  P,
  type Res,
  type Sql,
  startHd1,
  T,
} from "../../V2-A/_support/v2a";

export type { CtxN1, Json, Res, Sql };
export { call, d, deal, ok, P, startHd1, T };

type Person = (typeof P)[keyof typeof P];

export async function needV2d(sql: Sql): Promise<void> {
  const [r] = await sql<{ t: boolean; f: boolean }[]>`select
    to_regclass('contracts.milestone_items') is not null and to_regclass('contracts.service_customers') is not null as t,
    to_regprocedure('contracts.v2d_sync_service_customers(uuid,uuid)') is not null as f`;
  expect({ v2d_migration_0026: r }).toEqual({ v2d_migration_0026: { t: true, f: true } });
}

/** V2-A arrange (dọn HĐ + sổ) + dọn SP/kho/khách đang dùng/SL mốc. */
export async function arrangeV2d(c: CtxN1): Promise<void> {
  await needV2d(c.sql);
  await c.sql`truncate contracts.milestone_items, contracts.service_customers`;
  await arrangeV2a(c);
  await c.sql`truncate contracts.products cascade`;
}

export type Mode = "stock" | "quota" | "order" | "none";
/** SP + thành phần (owner). Một thành phần cùng tên nếu không chỉ định. */
export async function product(
  sql: Sql,
  p: {
    name: string;
    grp: "service" | "goods" | "referral";
    components?: { name: string; mode: Mode }[];
    tenant?: string;
  },
): Promise<{ id: string; comps: string[] }> {
  const tenant = p.tenant ?? T.acme;
  const mode: Mode = p.grp === "referral" ? "none" : p.grp === "goods" ? "stock" : "quota";
  const comps = p.components ?? [{ name: p.name, mode }];
  const [r] = await sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${tenant}, ${p.name}, 'cái', ${p.grp}) returning id::text`;
  const id = (r as { id: string }).id;
  const rows = await sql<
    { id: string }[]
  >`insert into contracts.product_components (tenant_id, product_id, ord, name, mode)
    select ${tenant}::uuid, ${id}::uuid, x.ord, x.name, x.mode
    from jsonb_to_recordset(${sql.json(comps.map((x, i) => ({ ...x, ord: i })))}) as x(ord int, name text, mode text)
    order by x.ord returning id::text`;
  return { id, comps: rows.map((x) => x.id) };
}

let ord = 0;
/** Dòng HĐ gắn SP (owner). Trả id dòng. */
export async function item(
  sql: Sql,
  contractId: string,
  o: {
    name?: string;
    qty?: number | null;
    price?: number | null;
    productId?: string | null;
    componentIds?: string[] | null;
    tenant?: string;
  },
): Promise<string> {
  const [r] = await sql<{ id: string }[]>`insert into contracts.contract_items
      (tenant_id, contract_id, ord, name, qty, unit_price, product_id, component_ids)
    values (${o.tenant ?? T.acme}, ${contractId}, ${++ord}, ${o.name ?? `Dòng ${ord}`}, ${o.qty ?? null},
      ${o.price ?? null}, ${o.productId ?? null}, ${o.componentIds ?? null}) returning id::text`;
  return (r as { id: string }).id;
}

export type PlanRow = { item_id: string; qty: number | null };
/** Thêm mốc giao (editor) — thân thô. */
export const addDeliveryRaw = (
  c: CtxN1,
  contractId: string,
  items?: PlanRow[],
  p: Person = P.hoa,
) =>
  call(c, p, "POST", `/contracts/${contractId}/milestones`, {
    kind: "delivery",
    due_date: d(3),
    ...(items ? { items } : {}),
  });
export const addDelivery = async (
  c: CtxN1,
  contractId: string,
  items?: PlanRow[],
): Promise<string> => (await ok(addDeliveryRaw(c, contractId, items))).id;

/** Xác nhận mốc (editor) — thân thô. */
export const settleRaw = (c: CtxN1, id: string, p: Person = P.hoa, b: unknown = {}) =>
  call(c, p, "POST", `/obligations/${id}/settle`, b);

/** Trạng thái thành phần (owner): tồn số, giá trị, BQ. */
export async function comp(sql: Sql, id: string) {
  const [r] = await sql<{ on_hand: string; stock_value: string; avg_cost: string }[]>`
    select on_hand::float8::text as on_hand, stock_value::text, avg_cost::text
    from contracts.product_components where id = ${id}`;
  return r
    ? { onHand: Number(r.on_hand), value: Number(r.stock_value), avg: Number(r.avg_cost) }
    : null;
}

/** Dòng sổ kho của thành phần (owner). */
export async function movesOf(sql: Sql, componentId: string) {
  return sql<
    {
      direction: string;
      qty: number;
      unit_cost: number;
      amount: number;
      milestone_id: string | null;
    }[]
  >`
    select direction, qty::float8 as qty, unit_cost::float8 as unit_cost, amount::float8 as amount,
      milestone_id::text from contracts.stock_moves where component_id = ${componentId} order by seq`;
}

/** Lô của thành phần (owner). */
export async function lotsOf(sql: Sql, componentId: string) {
  return sql<{ qty: number; remaining: number; expires_on: string | null }[]>`
    select qty::float8 as qty, remaining::float8 as remaining, to_char(expires_on, 'YYYY-MM-DD') as expires_on
    from contracts.stock_lots where component_id = ${componentId} order by seq`;
}

/** SL đã giao theo dòng HĐ (owner). */
export async function deliveredOf(sql: Sql, itemId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select coalesce(sum(delivered), 0)::float8 as n
    from contracts.milestone_items where contract_item_id = ${itemId} and delivered is not null`;
  return r?.n ?? 0;
}

export async function statusOf(sql: Sql, milestoneId: string): Promise<string | undefined> {
  const [r] = await sql<
    { status: string }[]
  >`select status from contracts.obligations where id = ${milestoneId}`;
  return r?.status;
}

/** Nhập sẵn tồn: HĐ mua 1 dòng `qty` × `price` + mốc giao xác nhận ngay. */
export async function stockIn(
  c: CtxN1,
  productId: string,
  qty: number,
  price: number,
  o: { end?: string; componentIds?: string[] } = {},
): Promise<void> {
  const k = await deal(c.sql, { sale: false, end: o.end ?? d(365) });
  await item(c.sql, k, { qty, price, productId, componentIds: o.componentIds ?? null });
  const m = await addDelivery(c, k);
  await ok(settleRaw(c, m));
}
