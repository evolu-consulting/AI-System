// CR-096 · bảng mới của gói `contracts` (V2-B/C/E/H/J2/L/M) khai cho bộ RLS theo hợp đồng (rls-packs.int.test.ts).
import { tenantId, userId } from "./builders";
import type { Sql } from "./db";
import type { RlsTable } from "./rls-suite";

const who = userId(901);
/** Khoá dò của bảng khoá ghép phải khác nhau giữa hai tenant, kẻo B «thấy» hàng cùng khoá của chính mình. */
const idx = (t: string): number => (t === tenantId(901) ? 0 : 1);
const SCOPES = ["settings", "job_types"] as const;
const PERIODS = ["2026-09-01", "2026-08-01"] as const;
const rnd = (pk?: string): string => pk ?? crypto.randomUUID();
const one = async (sql: Sql, text: string, params: unknown[]): Promise<string> => {
  const rows = (await sql.unsafe(
    `${text} returning id::text as id`,
    params as never[],
  )) as unknown as { id: string }[];
  return rows[0]?.id as string;
};
const parent = (sql: Sql, table: string, t: string): Promise<string> =>
  sql
    .unsafe(`select id::text as id from ${table} where tenant_id = $1 order by id limit 1`, [t])
    .then((r) => (r[0] as unknown as { id: string }).id);

/** CR-096 · bảng khoá `id` mới của V2-B/C/J2/M (đọc/ghi chéo tenant); bảng khoá ghép/tenant ở `v2IgnoreTables`. */
export const v2Tables: RlsTable[] = [
  {
    name: "products",
    seed: (o, t) =>
      one(o, "insert into contracts.products (tenant_id, name, grp) values ($1, $2, 'goods')", [
        t,
        `P ${crypto.randomUUID()}`,
      ]),
    insert: (tx, t, pk) =>
      tx.unsafe(
        "insert into contracts.products (id, tenant_id, name, grp) values ($1, $2, $3, 'goods')",
        [rnd(pk), t, `P ${crypto.randomUUID()}`],
      ),
  },
  {
    name: "product_components",
    seed: async (o, t) =>
      one(
        o,
        "insert into contracts.product_components (tenant_id, product_id, name, mode) values ($1, $2, 'C', 'stock')",
        [t, await parent(o, "contracts.products", t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        "insert into contracts.product_components (id, tenant_id, product_id, name, mode) values ($1, $2, $3, 'C', 'stock')",
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "product_rules",
    seed: async (o, t) =>
      one(
        o,
        "insert into contracts.product_rules (tenant_id, product_id, pattern) values ($1, $2, 'băng keo')",
        [t, await parent(o, "contracts.products", t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        "insert into contracts.product_rules (id, tenant_id, product_id, pattern) values ($1, $2, $3, 'băng keo')",
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "product_supplier_prices",
    seed: async (o, t) =>
      one(
        o,
        `insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, source)
         values ($1, $2, 'NCC', 'new', 1, 'manual')`,
        [t, await parent(o, "contracts.products", t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.product_supplier_prices (id, tenant_id, product_id, supplier_name, kind, price, source)
         values ($1, $2, $3, 'NCC', 'new', 1, 'manual')`,
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "partner_roles",
    seed: (o, t) =>
      one(
        o,
        "insert into contracts.partner_roles (tenant_id, party_key, role) values ($1, $2, 'customer')",
        [t, `tax:${crypto.randomUUID()}`],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        "insert into contracts.partner_roles (id, tenant_id, party_key, role) values ($1, $2, $3, 'customer')",
        [rnd(pk), t, `tax:${crypto.randomUUID()}`],
      ),
  },
  {
    name: "partner_notes",
    seed: (o, t) =>
      one(
        o,
        "insert into contracts.partner_notes (tenant_id, party_key, body) values ($1, $2, 'ghi chú')",
        [t, `tax:${crypto.randomUUID()}`],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        "insert into contracts.partner_notes (id, tenant_id, party_key, body) values ($1, $2, $3, 'ghi chú')",
        [rnd(pk), t, `tax:${crypto.randomUUID()}`],
      ),
  },
  {
    name: "contract_delete_log", // V2-M · chỉ thêm; id bigint identity ⇒ INSERT không mang id
    seed: (o, t) =>
      one(
        o,
        "insert into contracts.contract_delete_log (tenant_id, contract_id, title) values ($1, $2, 'HD')",
        [t, crypto.randomUUID()],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        "insert into contracts.contract_delete_log (tenant_id, contract_id, title) values ($1, $2, 'HD')",
        [t, crypto.randomUUID()],
      ),
  },
];
/** Bảng khoá = tenant (V2-H business_settings, V2-L company_settings), như visibility_settings. */
const tenantPk = (name: string): RlsTable => ({
  name,
  pk: "tenant_id",
  seed: async (o, t) => {
    await o.unsafe(`insert into contracts.${name} (tenant_id) values ($1)`, [t]);
    return t;
  },
  insert: (tx, t) => tx.unsafe(`insert into contracts.${name} (tenant_id) values ($1)`, [t]),
});
v2Tables.push(tenantPk("business_settings"), tenantPk("company_settings"), {
  name: "score_configs_v2", // V2-E · khoá ghép (tenant_id, scope) ⇒ dò theo scope
  pk: "scope",
  seed: async (o, t) => {
    const scope = SCOPES[idx(t)];
    await o.unsafe(
      "insert into contracts.score_configs_v2 (tenant_id, scope, config) values ($1, $2, '{}')",
      [t, scope],
    );
    return scope;
  },
  insert: (tx, t) =>
    tx.unsafe(
      "insert into contracts.score_configs_v2 (tenant_id, scope, config) values ($1, 'settings', '{}')",
      [t],
    ),
});
// V2-E · điểm chốt / đánh giá sao (chỉ thêm). Khoá ghép ⇒ dò theo một cột chuỗi duy nhất mỗi lần seed.
const lockIns =
  "insert into contracts.score_locks (tenant_id, period, party_key, role, grp, level, jobs) values ($1, '2026-09-01', $2, 'customer', 'all', 'new', 0)";
v2Tables.push(
  {
    name: "score_locks",
    pk: "party_key",
    seed: async (o, t) => {
      const k = `tax:${crypto.randomUUID()}`;
      await o.unsafe(lockIns, [t, k]);
      return k;
    },
    insert: (tx, t, pk) => tx.unsafe(lockIns, [t, pk ?? `tax:${crypto.randomUUID()}`]),
  },
  {
    name: "score_lock_runs",
    pk: "period",
    seed: async (o, t) => {
      const period = PERIODS[idx(t)];
      await o.unsafe(
        "insert into contracts.score_lock_runs (tenant_id, period, rows) values ($1, $2, 0)",
        [t, period],
      );
      return period;
    },
    insert: (tx, t) =>
      tx.unsafe(
        "insert into contracts.score_lock_runs (tenant_id, period, rows) values ($1, '2026-09-01', 0)",
        [t],
      ),
  },
  {
    name: "score_ratings", // id bigint identity ⇒ INSERT không mang id
    seed: (o, t) =>
      one(
        o,
        `insert into contracts.score_ratings (tenant_id, party_key, role, grp, criterion, stars, by_user)
         values ($1, 'tax:1', 'customer', 'goods', 'pay_on_time', 4, $2)`,
        [t, who],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        `insert into contracts.score_ratings (tenant_id, party_key, role, grp, criterion, stars, by_user)
         values ($1, 'tax:1', 'customer', 'goods', 'pay_on_time', 4, $2)`,
        [t, who],
      ),
  },
);
/** Đã có ca cách ly tenant ở bộ riêng của lát: V2-B rls (stock_lots, stock_moves), V2-D rls (milestone_items, service_customers), V2-K todo (todo_dismissals). */
export const v2IgnoreTables = [
  "milestone_items",
  "service_customers",
  "stock_lots",
  "stock_moves",
  "todo_dismissals",
] as const;
