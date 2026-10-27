// CR-096 · bảng mới của gói `contracts` (V2-B/C/E/H/J2/L/M) khai cho bộ RLS theo hợp đồng (rls-packs.int.test.ts).
import { tenantId, userId } from "./builders";
import type { Sql } from "./db";
import type { RlsTable } from "./rls-suite";

const who = userId(901);
/** Khoá dò của bảng khoá ghép phải khác nhau giữa hai tenant, kẻo B «thấy» hàng cùng khoá của chính mình. */
const pick = <T>(pair: readonly [T, T], t: string): T => (t === tenantId(901) ? pair[0] : pair[1]);
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
// CR-097 G1 · Giao dịch (0051): giao dịch + dòng (khoá id) + vết (id bigint identity ⇒ INSERT không mang id).
const txIns = `insert into contracts.transactions (id, tenant_id, deal, occurred_on, partner_name, created_by)
  values ($1, $2, 'sell', '2026-10-01', 'Khách', $3)`;
v2Tables.push(
  {
    name: "transactions",
    seed: (o, t) =>
      one(
        o,
        "insert into contracts.transactions (tenant_id, deal, occurred_on, partner_name, created_by) values ($1, 'sell', '2026-10-01', 'Khách', $2)",
        [t, who],
      ),
    insert: (tx, t, pk) => tx.unsafe(txIns, [rnd(pk), t, who]),
  },
  {
    name: "transaction_lines",
    seed: async (o, t) =>
      one(
        o,
        `insert into contracts.transaction_lines (tenant_id, transaction_id, ord, name, qty, unit_price, amount)
         values ($1, $2, 0, 'Hàng', 1, 1, 1)`,
        [t, await parent(o, "contracts.transactions", t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.transaction_lines (id, tenant_id, transaction_id, ord, name, qty, unit_price, amount)
         values ($1, $2, $3, 0, 'Hàng', 1, 1, 1)`,
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "transaction_events",
    seed: async (o, t) =>
      one(
        o,
        "insert into contracts.transaction_events (tenant_id, transaction_id, type, actor_user_id) values ($1, $2, 'created', $3)",
        [t, await parent(o, "contracts.transactions", t), who],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        "insert into contracts.transaction_events (tenant_id, transaction_id, type, actor_user_id) values ($1, $2, 'created', $3)",
        [t, crypto.randomUUID(), who],
      ),
  },
);
// cf-esign-docusign · envelope ký số (0054): đọc/ghi chéo tenant bị chặn như mọi bảng gói.
const envIns = `insert into contracts.esign_envelopes (id, tenant_id, contract_id, provider, envelope_id, signers, sent_by)
  values ($1, $2, $3, 'fake', $4, '[{"role":"company","name":"A","email":"a@x.vn","order":1}]', $5)`;
v2Tables.push({
  name: "esign_envelopes",
  seed: async (o, t) =>
    one(
      o,
      `insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by)
       values ($1, $2, 'fake', $3, '[{"role":"company","name":"A","email":"a@x.vn","order":1}]', $4)`,
      [t, await parent(o, "contracts.contracts", t), `env-${crypto.randomUUID()}`, who],
    ),
  insert: (tx, t, pk) =>
    tx.unsafe(envIns, [rnd(pk), t, crypto.randomUUID(), `env-${crypto.randomUUID()}`, who]),
});
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
    const scope = pick(SCOPES, t);
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
      const period = pick(PERIODS, t);
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

// D1/D2/niti-import · bảng id (product_sources, partner_contacts, price_scout_alerts) + bảng khoá ghép (dò theo một cột).
const alertIns = `insert into contracts.price_scout_alerts (id, tenant_id, product_id, day, kind, detail)
  values ($1, $2, $3, '2026-10-01', 'threshold', 'x')`;
const srcIns = `insert into contracts.product_sources (id, tenant_id, product_id, supplier_name, supplier_party_key)
  values ($1, $2, $3, 'NCC', $4)`;
const impIns =
  "insert into contracts.import_rows (tenant_id, source, tbl, row_key) values ($1, 'src', 'abc', $2)";
v2Tables.push(
  {
    name: "product_sources",
    seed: async (o, t) =>
      one(
        o,
        "insert into contracts.product_sources (tenant_id, product_id, supplier_name, supplier_party_key) values ($1, $2, 'NCC', $3)",
        [t, await parent(o, "contracts.products", t), `tax:${crypto.randomUUID()}`],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(srcIns, [rnd(pk), t, crypto.randomUUID(), `tax:${crypto.randomUUID()}`]),
  },
  {
    name: "partner_contacts",
    seed: (o, t) =>
      one(
        o,
        "insert into contracts.partner_contacts (tenant_id, party_key, name, created_by) values ($1, $2, 'LH', $3)",
        [t, `tax:${crypto.randomUUID()}`, who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        "insert into contracts.partner_contacts (id, tenant_id, party_key, name) values ($1, $2, $3, 'LH')",
        [rnd(pk), t, `tax:${crypto.randomUUID()}`],
      ),
  },
  {
    name: "price_scout_alerts",
    seed: async (o, t) =>
      one(
        o,
        "insert into contracts.price_scout_alerts (tenant_id, product_id, day, kind, detail) values ($1, $2, '2026-10-01', 'threshold', 'x')",
        [t, await parent(o, "contracts.products", t)],
      ),
    insert: (tx, t, pk) => tx.unsafe(alertIns, [rnd(pk), t, crypto.randomUUID()]),
  },
  {
    name: "price_scout_quota", // khoá = tenant
    pk: "tenant_id",
    seed: async (o, t) => {
      await o.unsafe("insert into contracts.price_scout_quota (tenant_id) values ($1)", [t]);
      return t;
    },
    insert: (tx, t) =>
      tx.unsafe("insert into contracts.price_scout_quota (tenant_id) values ($1)", [t]),
  },
  {
    name: "price_scout_usage", // khoá ghép (tenant_id, day) ⇒ dò theo day
    pk: "day",
    seed: async (o, t) => {
      const day = pick(PERIODS, t);
      await o.unsafe("insert into contracts.price_scout_usage (tenant_id, day) values ($1, $2)", [
        t,
        day,
      ]);
      return day;
    },
    insert: (tx, t) =>
      tx.unsafe(
        "insert into contracts.price_scout_usage (tenant_id, day) values ($1, '2026-09-01')",
        [t],
      ),
  },
  {
    name: "price_scout_defaults", // khoá ghép (tenant_id, grp) ⇒ dò theo grp
    pk: "grp",
    seed: async (o, t) => {
      const grp = pick(["goods", "service"] as const, t);
      await o.unsafe(
        "insert into contracts.price_scout_defaults (tenant_id, grp) values ($1, $2)",
        [t, grp],
      );
      return grp;
    },
    insert: (tx, t) =>
      tx.unsafe(
        "insert into contracts.price_scout_defaults (tenant_id, grp) values ($1, 'goods')",
        [t],
      ),
  },
  {
    name: "price_scout_configs", // khoá ghép (tenant_id, product_id) ⇒ dò theo product_id
    pk: "product_id",
    seed: async (o, t) => {
      const pid = await parent(o, "contracts.products", t);
      await o.unsafe(
        "insert into contracts.price_scout_configs (tenant_id, product_id) values ($1, $2)",
        [t, pid],
      );
      return pid;
    },
    insert: (tx, t) =>
      tx.unsafe(
        "insert into contracts.price_scout_configs (tenant_id, product_id) values ($1, $2)",
        [t, crypto.randomUUID()],
      ),
  },
  {
    name: "import_rows", // khoá ghép (tenant_id, source, tbl, row_key) ⇒ dò theo row_key
    pk: "row_key",
    seed: async (o, t) => {
      const k = `k-${crypto.randomUUID()}`;
      await o.unsafe(impIns, [t, k]);
      return k;
    },
    insert: (tx, t, pk) => tx.unsafe(impIns, [t, pk ?? `k-${crypto.randomUUID()}`]),
  },
);
