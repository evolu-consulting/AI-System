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
      "truncate contracts.contract_items, contracts.contract_reminders, contracts.contract_events, contracts.contracts, contracts.contract_categories, contracts.files, contracts.index_outbox",
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
    ...frameTables("contracts").slice(1),
  ],
});
