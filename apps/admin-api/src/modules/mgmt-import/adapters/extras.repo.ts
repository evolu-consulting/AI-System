// niti-import2 · `ExtrasStore` trên pool `hub_api` (NOBYPASSRLS): hub (`withHubScope` user = chủ đích — RLS khớp chủ hàng; đọc trạng
// thái / xoá hội thoại khi hoàn tác = scope `system` lọc tenant+user tường minh) và gói contracts (`withPackScope`, role
// `contracts_rw`, việc nền). Mỗi bảng MỘT câu văn bản cố định, dữ liệu lô qua MỘT tham số JSON (Luật 4c). Hàng gói: câu chèn ghi
// luôn sổ `contracts.import_rows` cho các hàng THỰC SỰ chèn (CTE `returning`) ⇒ hoàn tác chỉ xoá hàng của lô.
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { withPackScope } from "@ai/db/pack-scope";
import { type SQL, sql } from "drizzle-orm";
import type { ExtrasState, ExtrasStore } from "../application/extras-ports";
import type { ExtraTable } from "../domain/extras-contracts.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
const user = (tenantId: string, userId: string) => ({ kind: "user" as const, tenantId, userId });
const pack = (tenantId: string) => ({ packKey: "contracts", tenantId, userId: null });
const n = (rows: unknown[]) => rows.length;

const CONV = (
  t: string,
  u: string,
  s: string,
  j: string,
) => sql`insert into hub.conversations (id, tenant_id, user_id,
    title, title_norm, created_at, updated_at, import_source, archived_at)
  select x.id, ${t}::uuid, ${u}::uuid, x.title, x.title_norm, x.created_at, x.updated_at, ${s}, x.archived_at
  from jsonb_to_record(${j}::jsonb) as x(id uuid, title text, title_norm text, created_at timestamptz,
    updated_at timestamptz, archived_at timestamptz)
  on conflict (id) do nothing returning 1`;
const FLOW = (
  t: string,
  u: string,
  j: string,
) => sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title,
    agent_id, message_count, created_at, last_active_at)
  select x.id, ${t}::uuid, ${u}::uuid, x.conversation_id, x.title, null, x.message_count, x.created_at, x.last_active_at
  from jsonb_to_record(${j}::jsonb) as x(id uuid, conversation_id uuid, title text, message_count int,
    created_at timestamptz, last_active_at timestamptz)
  where exists (select 1 from hub.conversations c where c.id = x.conversation_id and c.tenant_id = ${t}::uuid)
  on conflict (id) do nothing returning 1`;
const MSGS = (
  t: string,
  u: string,
  j: string,
) => sql`insert into hub.messages (id, tenant_id, user_id, conversation_id,
    flow_id, role, content, created_at)
  select x.id, ${t}::uuid, ${u}::uuid, x.conversation_id, x.flow_id, x.role, x.content, x.created_at
  from jsonb_to_recordset(${j}::jsonb) as x(id uuid, conversation_id uuid, flow_id uuid, role text, content text,
    created_at timestamptz)
  where exists (select 1 from hub.flows f where f.id = x.flow_id and f.tenant_id = ${t}::uuid)
  on conflict (id) do nothing returning 1`;
const ATTS = (
  t: string,
  u: string,
  j: string,
) => sql`insert into hub.attachments (id, tenant_id, user_id, origin,
    conversation_id, flow_id, message_id, position, filename, safe_name, mime, size, sha256, storage_key, created_at,
    bound_at, filebox_file_id, filebox_version_id)
  select x.id, ${t}::uuid, ${u}::uuid, 'upload', x.conversation_id, x.flow_id, x.message_id, x.position, x.filename,
    x.safe_name, x.mime, x.size, x.sha256, ${t}::text || '/' || x.id::text, x.created_at, x.bound_at, x.filebox_file_id,
    x.filebox_version_id
  from jsonb_to_recordset(${j}::jsonb) as x(id uuid, conversation_id uuid, flow_id uuid, message_id uuid, position smallint,
    filename text, safe_name text, mime text, size bigint, sha256 text, created_at timestamptz, bound_at timestamptz,
    filebox_file_id text, filebox_version_id text)
  where exists (select 1 from hub.messages m where m.id = x.message_id and m.tenant_id = ${t}::uuid)
  on conflict (id) do nothing returning 1`;

/** Hàng gói: chèn (bỏ trùng) + ghi sổ các hàng vừa chèn; trả số hàng chèn. */
const REG = (
  t: string,
  s: string,
  tbl: string,
  ins: SQL,
  key: SQL,
) => sql`with ins as (${ins} returning ${key} as k),
  reg as (insert into contracts.import_rows (tenant_id, source, tbl, row_key)
    select ${t}::uuid, ${s}, ${tbl}, ins.k from ins on conflict do nothing)
  select count(*)::int as n from ins`;
const CUST = (
  t: string,
) => sql`(select c.id from contracts.cks_customers c where c.tenant_id = ${t}::uuid
  and ((x.cust_tax is not null and c.tax_id = x.cust_tax)
    or (x.cust_tax is null and c.tax_id is null and c.name_key = contracts.fold(x.cust_name))) limit 1)`;

const INS: Record<ExtraTable, (t: string, j: string) => SQL> = {
  cks_customers: (t, j) => sql`insert into contracts.cks_customers (id, tenant_id, name, tax_id)
    select x.id, ${t}::uuid, x.name, x.tax_id from jsonb_to_recordset(${j}::jsonb) as x(id uuid, name text, tax_id text)
    on conflict do nothing`,
  cks_certificates: (
    t,
    j,
  ) => sql`insert into contracts.cks_certificates (id, tenant_id, customer_id, serial, serial_key,
      ca, device, holder_name, holder_title, keeper, valid_from, valid_to, source, lot_id, sale_contract_id, sale_price,
      status, replaces, replaced_by, created_by, created_at)
    select x.id, ${t}::uuid, ${CUST(t)}, x.serial, x.serial_key, x.ca, x.device, x.holder_name, x.holder_title, x.keeper,
      x.valid_from, x.valid_to, x.source, null, x.sale_contract_id, x.sale_price, x.status, null, null, x.created_by,
      coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, cust_name text, cust_tax text, serial text, serial_key text, ca text,
      device text, holder_name text, holder_title text, keeper text, valid_from date, valid_to date, source text,
      sale_contract_id uuid, sale_price bigint, status text, created_by uuid, created_at timestamptz)
    where ${CUST(t)} is not null
    on conflict do nothing`,
  cks_signed_docs: (
    t,
    j,
  ) => sql`insert into contracts.cks_signed_docs (id, tenant_id, customer_id, certificate_id,
      serial_key, kind, number, title, signed_at, period, source, filename, sha256, unsigned, created_by, created_at)
    select x.id, ${t}::uuid, case when x.cust_name is not null or x.cust_tax is not null then ${CUST(t)} end,
      (select k.id from contracts.cks_certificates k where k.id = x.certificate_id and k.tenant_id = ${t}::uuid),
      x.serial_key, x.kind, x.number, x.title, x.signed_at, x.period, x.source, x.filename, x.sha256, x.unsigned,
      x.created_by, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, cust_name text, cust_tax text, certificate_id uuid, serial_key text,
      kind text, number text, title text, signed_at date, period text, source text, filename text, sha256 text,
      unsigned boolean, created_by uuid, created_at timestamptz)
    on conflict do nothing`,
  cks_market_prices: (
    t,
    j,
  ) => sql`insert into contracts.cks_market_prices (id, tenant_id, ca_key, ca_name, years, kind,
      device, seller, tier, price_ex_vat, url, verified, seen)
    select x.id, ${t}::uuid, x.ca_key, x.ca_name, x.years, x.kind, x.device, x.seller, x.tier, x.price_ex_vat, x.url,
      x.verified, x.seen
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, ca_key text, ca_name text, years int, kind text, device text,
      seller text, tier text, price_ex_vat bigint, url text, verified boolean, seen date)
    on conflict do nothing`,
  price_quotes: (
    t,
    j,
  ) => sql`insert into contracts.price_quotes (id, tenant_id, product_key, product_name, unit,
      supplier_name, supplier_tax_id, supplier_party_key, price, quoted_at, source, url, verified, page_date, check_note,
      note, created_by, created_at)
    select x.id, ${t}::uuid, x.product_key, x.product_name, x.unit, x.supplier_name, x.supplier_tax_id,
      contracts.party_key(x.supplier_name, x.supplier_tax_id), x.price, x.quoted_at, x.source, x.url, x.verified,
      x.page_date, x.check_note, x.note, x.created_by, coalesce(x.created_at, now())
    from jsonb_to_recordset(${j}::jsonb) as x(id uuid, product_key text, product_name text, unit text,
      supplier_name text, supplier_tax_id text, price bigint, quoted_at date, source text, url text, verified boolean,
      page_date date, check_note text, note text, created_by uuid, created_at timestamptz)
    on conflict do nothing`,
  legacy_records: (t, j) => sql`insert into contracts.legacy_records (tenant_id, kind, mgmt_id, doc)
    select ${t}::uuid, x.kind, x.mgmt_id, x.doc from jsonb_to_recordset(${j}::jsonb) as x(kind text, mgmt_id text, doc jsonb)
    on conflict do nothing`,
};
const KEY: Record<ExtraTable, SQL> = {
  cks_customers: sql`id::text`,
  cks_certificates: sql`id::text`,
  cks_signed_docs: sql`id::text`,
  cks_market_prices: sql`id::text`,
  price_quotes: sql`id::text`,
  legacy_records: sql`kind || '/' || mgmt_id`,
};

const HUB_STATE = (
  t: string,
  u: string,
  s: string,
) => sql`with c as (select id from hub.conversations
    where tenant_id = ${t}::uuid and user_id = ${u}::uuid and import_source = ${s}),
  n as (select id, read_at, fanout_at from hub.notifications where tenant_id = ${t}::uuid and user_id = ${u}::uuid
    and source = 'mgmt_import' and left(dedup_key, char_length(${s}) + 1) = ${s} || ':')
  select (select coalesce(jsonb_agg(id::text order by id), '[]'::jsonb) from c) as conversation_ids,
    (select count(*)::int from hub.flows f where f.tenant_id = ${t}::uuid and f.conversation_id in (select id from c)) as flows,
    (select count(*)::int from hub.messages m where m.tenant_id = ${t}::uuid and m.conversation_id in (select id from c)) as messages,
    (select coalesce(jsonb_agg(jsonb_build_object('id', a.id::text, 'file_id', a.filebox_file_id, 'sha256', a.sha256)
      order by a.id), '[]'::jsonb) from hub.attachments a where a.tenant_id = ${t}::uuid and a.conversation_id in (select id from c))
      as attachments,
    (select count(*)::int from n) as notifications,
    (select count(*)::int from n where read_at is null) as notifications_unread,
    (select count(*)::int from hub.notification_deliveries d where d.tenant_id = ${t}::uuid and d.notification_id in (select id from n))
      + (select count(*)::int from n where fanout_at is null) as deliveries`;

export function createExtrasStore(db: Db): ExtrasStore {
  return {
    attachmentsPresent: async (t, u, ids) =>
      new Set(
        (
          await withHubScope(db, user(t, u), (tx) =>
            run<{ id: string }>(
              tx,
              sql`select id::text as id from hub.attachments where tenant_id = ${t}::uuid
                and id = any(array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) as x))`,
            ),
          )
        ).map((r) => r.id),
      ),
    writeConversation: (t, u, s, x) =>
      withHubScope(db, user(t, u), async (tx) => ({
        conversations: n(await run(tx, CONV(t, u, s, JSON.stringify(x.conv)))),
        flows: n(await run(tx, FLOW(t, u, JSON.stringify(x.flow)))),
        messages: n(await run(tx, MSGS(t, u, JSON.stringify(x.messages)))),
        attachments: x.attachments.length
          ? n(await run(tx, ATTS(t, u, JSON.stringify(x.attachments))))
          : 0,
      })),
    writeNotifications: async (t, u, s, rows) => {
      const [r] = await withHubScope(db, user(t, u), (tx) =>
        run<{ n: number }>(
          tx,
          sql`select notify.import_read(${s}, ${JSON.stringify(rows)}::jsonb) as n`,
        ),
      );
      return r?.n ?? 0;
    },
    writeContracts: async (t, s, table, rows) => {
      const [r] = await withPackScope(db, pack(t), (tx) =>
        run<{ n: number }>(tx, REG(t, s, table, INS[table](t, JSON.stringify(rows)), KEY[table])),
      );
      return r?.n ?? 0;
    },
    async state(t, u, s): Promise<ExtrasState> {
      const [h] = await withHubScope(db, { kind: "system" }, (tx) =>
        run<Omit<ExtrasState, "contracts">>(tx, HUB_STATE(t, u, s)),
      );
      const reg = await withPackScope(db, pack(t), (tx) =>
        run<{ k: string; n: number }>(
          tx,
          sql`select case when tbl = 'legacy_records' then tbl || ':' || split_part(row_key, '/', 1) else tbl end as k,
            count(*)::int as n from contracts.import_rows where tenant_id = ${t}::uuid and source = ${s} group by 1`,
        ),
      );
      return {
        ...(h as Omit<ExtrasState, "contracts">),
        contracts: Object.fromEntries(reg.map((r) => [r.k, r.n])),
      };
    },
    async rollback(t, u, s) {
      const hub = await withHubScope(db, { kind: "system" }, async (tx) => {
        const c = sql`(select id from hub.conversations where tenant_id = ${t}::uuid and user_id = ${u}::uuid
          and import_source = ${s})`;
        const a = n(
          await run(
            tx,
            sql`delete from hub.attachments where tenant_id = ${t}::uuid and conversation_id in ${c} returning 1`,
          ),
        );
        const v = n(await run(tx, sql`delete from hub.conversations where id in ${c} returning 1`));
        return { attachments: a, conversations: v };
      });
      const [nt] = await withHubScope(db, user(t, u), (tx) =>
        run<{ n: number }>(tx, sql`select notify.import_rollback(${s}) as n`),
      );
      const [k] = await withPackScope(db, pack(t), (tx) =>
        run<{ r: Record<string, number> }>(
          tx,
          sql`select contracts.import_rollback(${t}::uuid, ${s}) as r`,
        ),
      );
      return { ...hub, notifications: nt?.n ?? 0, ...(k?.r ?? {}) };
    },
    async retentionMonths(t) {
      const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
        run<{ m: string | null }>(
          tx,
          sql`select settings ->> 'chat_history_months' as m from admin.tenants where id = ${t}::uuid`,
        ),
      );
      const m = Number(r?.m);
      return Number.isInteger(m) && m >= 1 && m <= 120 ? m : 12;
    },
  };
}
