// TK1 · PK-NFR-04 · PK-AC01 · PK-AC03 · HD-NFR-04 · chứng minh bộ RLS theo hợp đồng trên gói `contracts` (thật) và `pkdemo` (mẫu).
// Mỗi gói chỉ khai bảng + cách seed/insert; ca cách ly do `defineRlsSuite` sinh.

import { tenantId, userId } from "./builders";
import { cloneDb, openOwner, type Sql } from "./db";
import { defineRlsSuite, type RlsTable } from "./rls-suite";

const tenants = { a: tenantId(901), b: tenantId(902) };
const who = userId(901);
const open = async (): Promise<Sql> => {
  await cloneDb("full");
  return openOwner(2);
};
const close = async (owner: Sql): Promise<void> => {
  await owner.end({ timeout: 2 });
};

/** `INSERT … RETURNING id::text` (owner hoặc role) — trả khoá chính dạng chuỗi. */
const one = async (sql: Sql, text: string, params: unknown[]): Promise<string> => {
  const rows = (await sql.unsafe(
    `${text} returning id::text as id`,
    params as never[],
  )) as unknown as { id: string }[];
  return rows[0]?.id as string;
};
const rnd = (pk?: string): string => pk ?? crypto.randomUUID();
const org = (t: string): string => `t_${t}`;

const frameTables = (k: string): RlsTable[] => [
  {
    name: "files",
    seed: (o, t) =>
      one(
        o,
        `insert into ${k}.files (tenant_id, org, file_id, name, mime, size_bytes, created_by) values ($1, $2, $3, 'a.pdf', 'application/pdf', 1, $4)`,
        [t, org(t), crypto.randomUUID(), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${k}.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by) values ($1, $2, $3, $4, 'a.pdf', 'application/pdf', 1, $5)`,
        [rnd(pk), t, org(t), crypto.randomUUID(), who],
      ),
  },
  {
    name: "index_outbox",
    writeOnly: true,
    seed: (o, t) =>
      one(
        o,
        `insert into ${k}.index_outbox (tenant_id, entity, entity_id, op) values ($1, 'item', $2, 'upsert')`,
        [t, crypto.randomUUID()],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        `insert into ${k}.index_outbox (tenant_id, entity, entity_id, op) values ($1, 'item', $2, 'upsert')`,
        [t, crypto.randomUUID()],
      ),
  },
];

const parent = (sql: Sql, table: string, t: string): Promise<string> =>
  sql
    .unsafe(`select id::text as id from ${table} where tenant_id = $1 order by id limit 1`, [t])
    .then((r) => (r[0] as unknown as { id: string }).id);

/** HD9-AC08 · 8 bảng CKS (D9-01): cha khai trước con; hàng ghi qua role dùng cha giả (bị RLS chặn trước FK). */
const CKS = "contracts.cks_";
const cust = (sql: Sql, t: string) => parent(sql, `${CKS}customers`, t);
const cksTables: RlsTable[] = [
  {
    name: "cks_customers",
    seed: (o, t) =>
      one(o, `insert into ${CKS}customers (tenant_id, name) values ($1, $2)`, [t, `K ${t}`]),
    insert: (tx, t, pk) =>
      tx.unsafe(`insert into ${CKS}customers (id, tenant_id, name) values ($1, $2, $3)`, [
        rnd(pk),
        t,
        `K${Math.random()}`,
      ]),
  },
  {
    name: "cks_lots",
    seed: (o, t) =>
      one(
        o,
        `insert into ${CKS}lots (tenant_id, label, ca, qty, unit_cost, bought_at, purchase_contract_id, created_by)
         values ($1, '2026-01', 'CA', 1, 1, '2026-01-01', $2, $3)`,
        [t, crypto.randomUUID(), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${CKS}lots (id, tenant_id, label, ca, qty, unit_cost, bought_at, purchase_contract_id, created_by)
         values ($1, $2, '2026-01', 'CA', 1, 1, '2026-01-01', $3, $4)`,
        [rnd(pk), t, crypto.randomUUID(), who],
      ),
  },
  {
    name: "cks_certificates",
    seed: async (o, t) =>
      one(
        o,
        `insert into ${CKS}certificates (tenant_id, customer_id, ca, holder_name, valid_to, source)
         values ($1, $2, 'CA', 'A', '2027-01-01', 'ours')`,
        [t, await cust(o, t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${CKS}certificates (id, tenant_id, customer_id, ca, holder_name, valid_to, source)
         values ($1, $2, $3, 'CA', 'A', '2027-01-01', 'ours')`,
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "cks_renewals",
    seed: async (o, t) =>
      one(
        o,
        `insert into ${CKS}renewals (tenant_id, sale_contract_id, customer_id, certificate_ids, new_contract_id,
           price_each, valid_to, created_by)
         values ($1, $2, $3, array[$2]::uuid[], $2, 1, '2027-01-01', $4)`,
        [t, crypto.randomUUID(), await cust(o, t), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${CKS}renewals (id, tenant_id, sale_contract_id, customer_id, certificate_ids, new_contract_id,
           price_each, valid_to, created_by)
         values ($1, $2, $3, $3, array[$3]::uuid[], $3, 1, '2027-01-01', $4)`,
        [rnd(pk), t, crypto.randomUUID(), who],
      ),
  },
  {
    name: "cks_followups",
    seed: async (o, t) =>
      one(
        o,
        `insert into ${CKS}followups (tenant_id, user_id, customer_id, due_at) values ($1, $2, $3, now())`,
        [t, who, await cust(o, t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${CKS}followups (id, tenant_id, user_id, customer_id, due_at) values ($1, $2, $3, $4, now())`,
        [rnd(pk), t, who, crypto.randomUUID()],
      ),
  },
  {
    name: "cks_signed_docs",
    seed: (o, t) =>
      one(
        o,
        `insert into ${CKS}signed_docs (tenant_id, kind, title, source, filename, sha256, created_by)
         values ($1, 'other', 'X', 'xml', 'a.xml', $2, $3)`,
        [t, "a".repeat(64), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${CKS}signed_docs (id, tenant_id, kind, title, source, filename, sha256, created_by)
         values ($1, $2, 'other', 'X', 'xml', 'a.xml', $3, $4)`,
        [rnd(pk), t, "b".repeat(64), who],
      ),
  },
  {
    name: "cks_market_prices",
    seed: (o, t) =>
      one(
        o,
        `insert into ${CKS}market_prices (tenant_id, ca_key, years, seller, seen) values ($1, 'ca', 1, 'S', '2026-01-01')`,
        [t],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into ${CKS}market_prices (id, tenant_id, ca_key, years, seller, seen) values ($1, $2, 'ca', 1, 'S', '2026-01-01')`,
        [rnd(pk), t],
      ),
  },
  {
    name: "cks_price_audit",
    seed: (o, t) =>
      one(
        o,
        `insert into ${CKS}price_audit (tenant_id, entity, entity_id, field, new_value, actor_user_id)
         values ($1, 'lot', $2, 'unit_cost', 1, $3)`,
        [t, crypto.randomUUID(), who],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        `insert into ${CKS}price_audit (tenant_id, entity, entity_id, field, new_value, actor_user_id)
         values ($1, 'lot', $2, 'unit_cost', 1, $3)`,
        [t, crypto.randomUUID(), who],
      ),
  },
];

/** HD7-NFR-01 · sổ thanh toán (migration gói 0008): đợt, sổ đối tác (chỉ thêm), bảng huỷ (FK kép sang sổ). */
const ledgerTables: RlsTable[] = [
  {
    name: "obligations",
    seed: (o, t) =>
      one(
        o,
        `insert into contracts.obligations (tenant_id, contract_id, direction, seq, due_date) values ($1, $2, 'pay', 1, '2026-10-01')`,
        [t, crypto.randomUUID()],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.obligations (id, tenant_id, contract_id, direction, seq, due_date) values ($1, $2, $3, 'pay', 1, '2026-10-01')`,
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "partner_events",
    seed: (o, t) =>
      one(
        o,
        `insert into contracts.partner_events (tenant_id, party_key, role, type, at, source) values ($1, 'tax:1', 'customer', 'complaint', '2026-10-01', 'action')`,
        [t],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        `insert into contracts.partner_events (tenant_id, party_key, role, type, at, source) values ($1, 'tax:1', 'customer', 'complaint', '2026-10-01', 'action')`,
        [t],
      ),
  },
  {
    name: "partner_event_voids",
    pk: "event_id",
    seed: async (o, t) => {
      const ev = await parent(o, "contracts.partner_events", t);
      const rows = (await o.unsafe(
        "insert into contracts.partner_event_voids (event_id, tenant_id) values ($1, $2) returning event_id::text as id",
        [ev, t],
      )) as unknown as { id: string }[];
      return rows[0]?.id as string;
    },
    insert: (tx, t, pk) =>
      // `event_id` là bigint: id thăm dò không phải số (NIL uuid) ⇒ một số chắc chắn không tồn tại, để A và NIL cùng đi tới RLS.
      tx.unsafe("insert into contracts.partner_event_voids (event_id, tenant_id) values ($1, $2)", [
        pk && /^\d+$/.test(pk) ? pk : "999999999",
        t,
      ]),
  },
];

/** W1 · nguồn mua do người chọn (migration gói 0010); không FK sang HĐ (D9-02), thấy được khi thấy HĐ bán (M1D). */
const sourcingTables: RlsTable[] = [
  // I1 · vùng chờ của importer mgmt-app (migration gói 0012); khoá chính (tenant_id, kind, mgmt_id) ⇒ dùng mgmt_id (duy nhất mỗi lần seed).
  {
    name: "legacy_records",
    pk: "mgmt_id",
    seed: async (o, t) => {
      const id = `m-${crypto.randomUUID()}`;
      await o.unsafe(
        `insert into contracts.legacy_records (tenant_id, kind, mgmt_id, doc) values ($1, 'followup', $2, '{}')`,
        [t, id],
      );
      return id;
    },
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.legacy_records (tenant_id, kind, mgmt_id, doc) values ($1, 'followup', $2, '{}')`,
        [t, pk ?? `m-${crypto.randomUUID()}`],
      ),
  },
  {
    name: "followups",
    seed: (o, t) =>
      one(
        o,
        `insert into contracts.followups (tenant_id, user_id, subject_kind, subject_id, due_at, title)
         values ($1, $2, 'company', $3, now(), 'T')`,
        [t, who, `tax:${crypto.randomUUID()}`],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.followups (id, tenant_id, user_id, subject_kind, subject_id, due_at, title)
         values ($1, $2, $3, 'company', $4, now(), 'T')`,
        [rnd(pk), t, who, `tax:${crypto.randomUUID()}`],
      ),
  },
  {
    name: "sourcing_choices",
    seed: (o, t) =>
      one(
        o,
        `insert into contracts.sourcing_choices (tenant_id, sale_contract_id, sale_line, source_contract_id, source_line, chosen_by)
         values ($1, $2, 0, $3, 0, $4)`,
        [t, crypto.randomUUID(), crypto.randomUUID(), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into contracts.sourcing_choices (id, tenant_id, sale_contract_id, sale_line, source_contract_id, source_line, chosen_by)
         values ($1, $2, $3, 0, $4, 0, $5)`,
        [rnd(pk), t, crypto.randomUUID(), crypto.randomUUID(), who],
      ),
  },
];

defineRlsSuite({
  key: "pkdemo",
  tenants,
  open,
  close,
  reset: async (o) => {
    await o.unsafe("truncate pkdemo.item_lines, pkdemo.items, pkdemo.files, pkdemo.index_outbox");
  },
  tables: [
    {
      name: "items",
      seed: (o, t) => one(o, "insert into pkdemo.items (tenant_id, title) values ($1, 'x')", [t]),
      insert: (tx, t, pk) =>
        tx.unsafe("insert into pkdemo.items (id, tenant_id, title) values ($1, $2, 'x')", [
          rnd(pk),
          t,
        ]),
    },
    {
      name: "item_lines",
      seed: async (o, t) =>
        one(o, "insert into pkdemo.item_lines (tenant_id, item_id, text) values ($1, $2, 'l')", [
          t,
          await parent(o, "pkdemo.items", t),
        ]),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into pkdemo.item_lines (id, tenant_id, item_id, text) values ($1, $2, $3, 'l')",
          [rnd(pk), t, crypto.randomUUID()],
        ),
    },
    ...frameTables("pkdemo"),
  ],
});

defineRlsSuite({
  key: "contracts",
  tenants,
  open,
  close,
  reset: async (o) => {
    await o.unsafe(
      "truncate contracts.legacy_records, contracts.followups, contracts.sourcing_choices, contracts.partner_event_voids, contracts.partner_events, contracts.obligations, contracts.cks_price_audit, contracts.cks_followups, contracts.cks_signed_docs, contracts.cks_renewals, contracts.cks_certificates, contracts.cks_lots, contracts.cks_customers, contracts.cks_market_prices, contracts.contract_items, contracts.contract_reminders, contracts.contract_events, contracts.approvals, contracts.contracts, contracts.contract_categories, contracts.files, contracts.index_outbox, contracts.approval_settings, contracts.approval_settings_audit, contracts.visibility_settings, contracts.score_configs, contracts.score_config_history, contracts.score_snapshots, contracts.price_quotes, contracts.market_observations, contracts.companies",
    );
  },
  tables: [
    {
      name: "contract_categories",
      seed: (o, t) =>
        one(o, "insert into contracts.contract_categories (tenant_id, name) values ($1, 'Cat')", [
          t,
        ]),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.contract_categories (id, tenant_id, name) values ($1, $2, $3)",
          [rnd(pk), t, `c${Math.random()}`],
        ),
    },
    ...frameTables("contracts").slice(0, 1), // files trước contracts (FK file_id)
    {
      name: "contracts",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.contracts (tenant_id, title, status, created_by) values ($1, 'HD', 'active', $2)",
          [t, who],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.contracts (id, tenant_id, title, status, created_by) values ($1, $2, 'HD', 'active', $3)",
          [rnd(pk), t, who],
        ),
    },
    {
      name: "contract_items",
      seed: async (o, t) =>
        one(
          o,
          "insert into contracts.contract_items (tenant_id, contract_id, ord, name) values ($1, $2, 0, 'Hàng')",
          [t, await parent(o, "contracts.contracts", t)],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.contract_items (id, tenant_id, contract_id, ord, name) values ($1, $2, $3, 0, 'Hàng')",
          [rnd(pk), t, crypto.randomUUID()],
        ),
    },
    {
      name: "contract_reminders",
      seed: async (o, t) =>
        one(
          o,
          "insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel) values ($1, $2, '2026-12-31', 30, $3, 'email')",
          [t, await parent(o, "contracts.contracts", t), who],
        ),
      insert: (tx, t) =>
        tx.unsafe(
          "insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel) values ($1, $2, '2026-12-31', 30, $3, 'email')",
          [t, crypto.randomUUID(), who],
        ),
    },
    {
      name: "contract_events",
      seed: async (o, t) =>
        one(
          o,
          "insert into contracts.contract_events (tenant_id, contract_id, type) values ($1, $2, 'field_edited')",
          [t, await parent(o, "contracts.contracts", t)],
        ),
      insert: (tx, t) =>
        tx.unsafe(
          "insert into contracts.contract_events (tenant_id, contract_id, type) values ($1, $2, 'field_edited')",
          [t, crypto.randomUUID()],
        ),
    },
    // M3-decouple · lượt duyệt của máy trạng thái trong gói (migration gói 0010); hàng ghi qua role dùng HĐ giả (RLS chặn trước FK).
    {
      name: "approvals",
      seed: async (o, t) =>
        one(
          o,
          "insert into contracts.approvals (tenant_id, contract_id, status, started_by) values ($1, $2, 'done', $3)",
          [t, await parent(o, "contracts.contracts", t), who],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.approvals (id, tenant_id, contract_id, status, started_by) values ($1, $2, $3, 'done', $4)",
          [rnd(pk), t, crypto.randomUUID(), who],
        ),
    },
    // HD-FR-37 · AC37c · HD3: luật duyệt theo tenant (migration gói 0005).
    {
      name: "approval_settings",
      seed: (o, t) =>
        one(o, "insert into contracts.approval_settings (tenant_id) values ($1)", [t]),
      insert: (tx, t, pk) =>
        tx.unsafe("insert into contracts.approval_settings (id, tenant_id) values ($1, $2)", [
          rnd(pk),
          t,
        ]),
    },
    // HD4-NFR-02 · lịch nhắc (migration gói 0003): hàng tự tạo khi HĐ đã duyệt được chèn (trigger), khoá = contract_id.
    {
      name: "contract_schedule",
      pk: "contract_id",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.contracts (tenant_id, title, status, created_by) values ($1, 'HD', 'active', $2)",
          [t, who],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.contract_schedule (contract_id, tenant_id, remind_at) values ($1, $2, now())",
          [rnd(pk), t],
        ),
    },
    ...cksTables,
    ...ledgerTables,
    ...sourcingTables,
    // Review HD3 M1 · nhật ký đổi luật duyệt (migration gói 0006, append-only).
    {
      name: "approval_settings_audit",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after) values ($1, $2, '{}', '{}')",
          [t, who],
        ),
      insert: (tx, t) =>
        tx.unsafe(
          "insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after) values ($1, $2, '{}', '{}')",
          [t, who],
        ),
    },
    // M1D-FR-04 · chế độ thấy theo tenant (migration gói 0009); khoá chính = tenant_id.
    {
      name: "visibility_settings",
      pk: "tenant_id",
      seed: async (o, t) => {
        await o.unsafe("insert into contracts.visibility_settings (tenant_id) values ($1)", [t]);
        return t;
      },
      insert: (tx, t) =>
        tx.unsafe("insert into contracts.visibility_settings (tenant_id) values ($1)", [t]),
    }, // HD8-NFR-01 · 0010: cấu hình điểm, lịch sử, ảnh chụp điểm, báo giá — RLS FORCE theo tenant.
    {
      name: "score_configs",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.score_configs (tenant_id, role, version, criteria, rules) values ($1, 'customer', 1, '[]', '{}')",
          [t],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.score_configs (id, tenant_id, role, version, criteria, rules) values ($1, $2, 'supplier', 1, '[]', '{}')",
          [rnd(pk), t],
        ),
    },
    {
      name: "score_config_history",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.score_config_history (tenant_id, role, version, summary, before, after) values ($1, 'customer', 1, 's', '{}', '{}')",
          [t],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.score_config_history (id, tenant_id, role, version, summary, before, after) values ($1, $2, 'customer', 1, 's', '{}', '{}')",
          [rnd(pk), t],
        ),
    },
    {
      name: "score_snapshots",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.score_snapshots (tenant_id, party_key, role, config_version) values ($1, 'tax:1', 'customer', 1)",
          [t],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.score_snapshots (id, tenant_id, party_key, role, config_version) values ($1, $2, 'tax:1', 'customer', 1)",
          [rnd(pk), t],
        ),
    },
    {
      name: "market_observations",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.market_observations (tenant_id, product_key, price_ex_vat, seen) values ($1, 'name:x|', 1, '2026-10-10')",
          [t],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.market_observations (id, tenant_id, product_key, price_ex_vat, seen) values ($1, $2, 'name:x|', 1, '2026-10-10')",
          [rnd(pk), t],
        ),
    },
    {
      name: "companies",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.companies (tenant_id, party_key, name) values ($1, 'name:a', 'A')",
          [t],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.companies (id, tenant_id, party_key, name) values ($1, $2, $3, 'A')",
          [rnd(pk), t, `name:${Math.random()}`],
        ),
    },
    {
      name: "price_quotes",
      seed: (o, t) =>
        one(
          o,
          "insert into contracts.price_quotes (tenant_id, product_key, product_name, supplier_name, supplier_party_key, price, quoted_at) values ($1, 'name:x|', 'X', 'A', 'name:a', 1, '2026-10-10')",
          [t],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into contracts.price_quotes (id, tenant_id, product_key, product_name, supplier_name, supplier_party_key, price, quoted_at) values ($1, $2, 'name:x|', 'X', 'A', 'name:a', 1, '2026-10-10')",
          [rnd(pk), t],
        ),
    },
    ...frameTables("contracts").slice(1),
  ],
});
