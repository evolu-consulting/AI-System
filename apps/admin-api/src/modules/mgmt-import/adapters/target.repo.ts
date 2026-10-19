// I1 · `TargetStore` trên Postgres: pool `hub_api` (NOBYPASSRLS), mỗi lô MỘT tx `withPackScope` (role `<gói>_rw` + tenant, việc
// nền ⇒ không user) và MỘT câu ghi (target.sql.ts). Đọc lại/tổng tiền cũng qua RLS của tenant — không dùng role chủ.
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { type SQL, sql } from "drizzle-orm";
import type { TargetStore } from "../application/ports";
import type { MoneyKey, Row, TableName } from "../domain/plan";
import { INSERTS, packOf } from "./target.sql";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const ident = (t: TableName): SQL => {
  const [schema, table] = t.split(".") as [string, string];
  return sql`${sql.identifier(schema)}.${sql.identifier(table)}`;
};
const uuids = (xs: readonly string[]) =>
  sql`array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb) as x)`;

/** Bảng có cột `id uuid` do importer cấp (đếm "đã có" theo id). */
const ID_TABLES = new Set<TableName>([
  "contracts.contract_categories",
  "contracts.files",
  "contracts.contracts",
  "contracts.contract_items",
  "contracts.cks_customers",
  "contracts.cks_lots",
  "contracts.cks_certificates",
  "contracts.cks_renewals",
  "contracts.cks_followups",
  "contracts.cks_signed_docs",
  "contracts.cks_market_prices",
  "contracts.obligations",
  "knowledge.documents",
  "knowledge.chunks",
]);

/** Tổng tiền đích — cùng công thức với `sourceMoney`; chỉ hàng có id thuộc kế hoạch (sự kiện sổ: theo `data.mgmt_source`). */
function moneySql(tid: string, ids: Partial<Record<TableName, string[]>>, source: string): SQL {
  const of = (t: TableName) => uuids(ids[t] ?? []);
  const T = sql`${tid}::uuid`;
  return sql`select
    (select coalesce(sum(value), 0)::text from contracts.contracts where tenant_id = ${T} and id = any(${of("contracts.contracts")})) as "contracts.total_value",
    (select coalesce(sum(unit_price), 0)::text from contracts.contract_items where tenant_id = ${T} and id = any(${of("contracts.contract_items")})) as "items.unit_price",
    (select coalesce(sum(amount), 0)::text from contracts.obligations where tenant_id = ${T} and id = any(${of("contracts.obligations")})) as "obligations.amount",
    (select coalesce(sum(amount), 0)::text from contracts.partner_events where tenant_id = ${T} and data->>'mgmt_source' = ${source}) as "partner_events.amount",
    (select coalesce(sum(qty::numeric * unit_cost), 0)::text from contracts.cks_lots where tenant_id = ${T} and id = any(${of("contracts.cks_lots")})) as "cks_lots.qty_x_unit_cost",
    (select coalesce(sum(sale_price), 0)::text from contracts.cks_certificates where tenant_id = ${T} and id = any(${of("contracts.cks_certificates")})) as "cks_certificates.sale_price",
    (select coalesce(sum(price_each), 0)::text from contracts.cks_renewals where tenant_id = ${T} and id = any(${of("contracts.cks_renewals")})) as "cks_renewals.price_each",
    (select coalesce(sum(price_ex_vat), 0)::text from contracts.cks_market_prices where tenant_id = ${T} and id = any(${of("contracts.cks_market_prices")})) as "cks_market_prices.price_ex_vat"`;
}

export function createTargetStore(db: Db, source: string): TargetStore {
  const scope = (tenantId: string, table: TableName) => ({
    packKey: packOf(table),
    tenantId,
    userId: null,
  });
  return {
    async write(tenantId, table, rows) {
      if (rows.length === 0) return 0;
      const q = INSERTS[table](tenantId, JSON.stringify(rows));
      return withPackScope(db, scope(tenantId, table), async (tx) => (await run(tx, q)).length);
    },
    async existing(tenantId, table, rows) {
      if (rows.length === 0) return 0;
      if (table === "contracts.legacy_records") {
        const keys = JSON.stringify(rows.map((r) => ({ kind: r.kind, mgmt_id: r.mgmt_id })));
        return withPackScope(db, scope(tenantId, table), async (tx) => {
          const [r] = await run<{ n: number }>(
            tx,
            sql`select count(*)::int as n from contracts.legacy_records l
            join jsonb_to_recordset(${keys}::jsonb) as x(kind text, mgmt_id text) on l.kind = x.kind and l.mgmt_id = x.mgmt_id
            where l.tenant_id = ${tenantId}::uuid`,
          );
          return r?.n ?? 0;
        });
      }
      if (!ID_TABLES.has(table)) return -1;
      const ids = rows.map((r) => String(r.id));
      return withPackScope(db, scope(tenantId, table), async (tx) => {
        const [r] = await run<{ n: number }>(
          tx,
          sql`select count(*)::int as n from ${ident(table)}
          where tenant_id = ${tenantId}::uuid and id = any(${uuids(ids)})`,
        );
        return r?.n ?? 0;
      });
    },
    async money(tenantId, ids) {
      const [r] = await withPackScope(db, { packKey: "contracts", tenantId, userId: null }, (tx) =>
        run<Record<string, string>>(tx, moneySql(tenantId, ids, source)),
      );
      const out: Partial<Record<MoneyKey, bigint>> = {};
      for (const [k, v] of Object.entries(r ?? {}))
        out[k as MoneyKey] = BigInt(String(v).split(".")[0] ?? "0");
      return out;
    },
    async readBack(tenantId, table, ids) {
      if (!ID_TABLES.has(table) || ids.length === 0) return [];
      return withPackScope(db, scope(tenantId, table), async (tx) =>
        (
          await run<{ j: Row }>(
            tx,
            sql`select to_jsonb(t) as j from ${ident(table)} t
          where tenant_id = ${tenantId}::uuid and id = any(${uuids(ids)})`,
          )
        ).map((r) => r.j),
      );
    },
    async hasTable(table) {
      const tid = "00000000-0000-4000-8000-000000000000";
      return withPackScope(
        db,
        { packKey: packOf(table), tenantId: tid, userId: null },
        async (tx) => {
          const [r] = await run<{ ok: boolean }>(
            tx,
            sql`select to_regclass(${table}) is not null as ok`,
          );
          return r?.ok === true;
        },
      );
    },
  };
}

/** Tập HĐ (id đích) mà `userId` thấy qua RLS thật của gói (`contracts_rw` + `app.user_id` ⇒ luật thấy M1). */
export async function visibleContracts(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<Set<string>> {
  const rows = await withPackScope(db, { packKey: "contracts", tenantId, userId }, (tx) =>
    run<{ id: string }>(
      tx,
      sql`select id from contracts.contracts where tenant_id = ${tenantId}::uuid`,
    ),
  );
  return new Set(rows.map((r) => r.id));
}
