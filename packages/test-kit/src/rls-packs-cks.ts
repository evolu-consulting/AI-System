// HD9-AC08 · bảng CKS của gói `contracts` khai cho bộ RLS (tách khỏi rls-packs.int.test.ts cho ≤ 600 dòng).
import type { Sql } from "./db";
import { one, parent, rnd, who } from "./rls-packs-helpers";
import type { RlsTable } from "./rls-suite";

/** HD9-AC08 · 8 bảng CKS (D9-01): cha khai trước con; hàng ghi qua role dùng cha giả (bị RLS chặn trước FK). */
const CKS = "contracts.cks_";
const cust = (sql: Sql, t: string) => parent(sql, `${CKS}customers`, t);
export const cksTables: RlsTable[] = [
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
