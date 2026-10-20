// V2-B · hạ tầng int: DB sạch (template `full`), 2 tenant, gói contracts bật, luật thấy M1 chế độ `org` ở tenant A. Ghi kho qua
// `applyDelivery` THẬT trong `withPackScope` (role `contracts_rw` + `app.tenant_id` + `app.user_id`, như request). SP dựng bằng owner.
// Không chứa `it(...)`.
import { type Db, withPackScope } from "@ai/db";
import { contracts, enablePack, members, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import {
  applyDelivery,
  type DeliveryMove,
  type DeliveryResult,
} from "../../../../apps/hub-api/src/modules/packs/contracts/adapters/stock.repo";

export type { DeliveryMove, DeliveryResult, Sql };
export { applyDelivery };

export type World = {
  sql: Sql;
  db: Db;
  A: string;
  B: string;
  /** A: owner gói (thấy hết) */
  boss: string;
  /** A: editor, phụ trách C1 */
  u1: string;
  /** A: editor ngang hàng, phụ trách C2 */
  u2: string;
  /** B: editor */
  b1: string;
  /** HĐ mua của u1 (A) · HĐ bán của u2 (A) · HĐ của b1 (B) */
  C1: string;
  C2: string;
  CB: string;
  stop(): Promise<void>;
};

export async function world(o: { ns: number }): Promise<World> {
  await cloneDb("full");
  const sql = openOwner(2);
  const [A, B] = (await tenants(sql, 2, o.ns)) as [string, string];
  const [boss, u1, u2] = (await users(sql, A, 3, { from: o.ns })) as [string, string, string];
  const [b1] = (await users(sql, B, 1, { from: o.ns + 50 })) as [string];
  const roles = await enablePack(sql, [A, B], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [boss]);
  await members(sql, A, roles.get(A)?.editor as string, [u1, u2]);
  await members(sql, B, roles.get(B)?.editor as string, [b1]);
  await visibility(sql, [A], "org");
  const [C1] = (await contracts(sql, A, 1, { from: o.ns, createdBy: u1, owner: u1 })) as [string];
  const [C2] = (await contracts(sql, A, 1, { from: o.ns + 1, createdBy: u2, owner: u2 })) as [
    string,
  ];
  const [CB] = (await contracts(sql, B, 1, { from: o.ns + 2, createdBy: b1, owner: b1 })) as [
    string,
  ];
  const db = connectDb(urls().hubApi, 4);
  return {
    sql,
    db,
    A,
    B,
    boss,
    u1,
    u2,
    b1,
    C1,
    C2,
    CB,
    stop: async () => {
      await db.close();
      await sql.end({ timeout: 1 });
    },
  };
}

export type CompSpec = { name: string; mode: "stock" | "quota" | "order" | "none" };
/** SP + thành phần (owner, bỏ RLS). Trả id SP và id thành phần theo thứ tự. */
export async function product(
  sql: Sql,
  tenant: string,
  p: { name: string; grp: "service" | "goods" | "referral"; components?: CompSpec[] },
): Promise<{ id: string; comps: string[] }> {
  const comps = p.components ?? [
    { name: p.name, mode: p.grp === "referral" ? "none" : p.grp === "goods" ? "stock" : "quota" },
  ];
  const [r] = await sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${tenant}, ${p.name}, 'cái', ${p.grp}) returning id::text`;
  const id = (r as { id: string }).id;
  const rows = await sql<
    { id: string }[]
  >`insert into contracts.product_components (tenant_id, product_id, ord, name, mode)
    select ${tenant}::uuid, ${id}::uuid, x.ord, x.name, x.mode
    from jsonb_to_recordset(${sql.json(comps.map((c, i) => ({ ...c, ord: i })))}) as x(ord int, name text, mode text)
    order by x.ord returning id::text`;
  return { id, comps: rows.map((x) => x.id) };
}

/** `applyDelivery` trong tx người dùng `user` (`""` = việc nền). */
export const deliver = (
  w: World,
  tenant: string,
  user: string,
  moves: DeliveryMove[],
  on = "2026-11-01",
): Promise<DeliveryResult> =>
  withPackScope(w.db, { packKey: "contracts", tenantId: tenant, userId: user || null }, (tx) =>
    applyDelivery(tx, moves, { tenantId: tenant, on }),
  );

/** Trạng thái thành phần (owner). */
export async function comp(sql: Sql, id: string) {
  const [r] = await sql<{ on_hand: string; stock_value: string; avg_cost: string }[]>`
    select on_hand::text, stock_value::text, avg_cost::text from contracts.product_components where id = ${id}`;
  return r
    ? { onHand: Number(r.on_hand), value: Number(r.stock_value), avg: Number(r.avg_cost) }
    : null;
}

/** Dòng sổ của thành phần (owner), theo thứ tự ghi. */
export async function movesOf(sql: Sql, componentId: string) {
  return sql<
    {
      direction: string;
      reason: string;
      qty: string;
      unit_cost: string;
      amount: string;
      lot_id: string | null;
      contract_id: string | null;
    }[]
  >`select direction, reason, qty::float8::text as qty, unit_cost::text, amount::text, lot_id::text, contract_id::text
    from contracts.stock_moves where component_id = ${componentId} order by seq`;
}

/** Lô của thành phần (owner), theo thứ tự nhập. */
export async function lotsOf(sql: Sql, componentId: string) {
  return sql<{ qty: number; remaining: number; expires_on: string | null }[]>`
    select qty::float8 as qty, remaining::float8 as remaining, to_char(expires_on, 'YYYY-MM-DD') as expires_on
    from contracts.stock_lots where component_id = ${componentId} order by seq`;
}

/** Lỗi `fn` ném: mã SQLSTATE, hoặc `code` của StockError. */
export async function failOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { code?: string; cause?: { code?: string } };
    return x.cause?.code ?? x.code ?? `no-code:${(e as Error).message}`;
  }
}
