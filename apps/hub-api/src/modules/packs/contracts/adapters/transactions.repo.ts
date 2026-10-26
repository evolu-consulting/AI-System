// CR-097 G1 · GD-FR-01…05: câu GHI của Giao dịch trong tx do `PackUow` mở (role `contracts_rw`, RLS tenant + M1); lọc `tenant_id`
// tường minh ngoài RLS. Mỗi hàm số câu SQL cố định (dữ liệu dòng qua MỘT tham số JSON, Luật 4c). Kho: `applyDelivery` /
// `reverseTransactionStock` (adapters/stock.repo.ts) — cùng đường với giao hàng HĐ và xoá HĐ.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type {
  TransactionsRepo,
  TxHeader,
  TxLineRow,
  TxLocked,
} from "../application/transactions.ports";
import type { DComp } from "../domain/delivery.rules";
import { json, one } from "./ledger-sql";
import { applyDelivery, reverseTransactionStock } from "./stock.repo";
import { compsQ, detailQ, linesQ, listQ, lockQ } from "./transactions-read.sql";

const ME = sql.raw("NULLIF(current_setting('app.user_id', true), '')::uuid");
/** Cột đầu ghi được qua `update`; `posted_at`/`cancelled_at` luôn = now() của tx. */
const COLS = new Set([
  "deal",
  "occurred_on",
  "due_on",
  "valid_until",
  "partner_name",
  "partner_tax_id",
  "product_group",
  "contract_id",
  "note",
  "holder",
  "lot_label",
  "total",
  "rev",
  "status",
  "posted_by",
  "cancelled_by",
  "cancel_reason",
]);
const NOW_COLS = new Set(["posted_at", "cancelled_at"]);

function setList(patch: Record<string, unknown>): SQL[] {
  return Object.entries(patch)
    .filter(([k, v]) => v !== undefined && (COLS.has(k) || NOW_COLS.has(k)))
    .map(([k, v]) =>
      NOW_COLS.has(k)
        ? sql`${sql.raw(k)} = now()`
        : sql`${sql.raw(k)} = ${v as string | number | null}`,
    );
}

const writeLinesQ = (t: string, id: string, rev: number, lines: readonly TxLineRow[]) =>
  sql`insert into contracts.transaction_lines (id, tenant_id, transaction_id, rev, ord, name, product_id, component_ids,
      unit, qty, unit_price, amount)
    select x.id, ${t}::uuid, ${id}::uuid, ${rev}::int, x.ord, x.name, x."productId",
      (select array_agg(v::uuid) from jsonb_array_elements_text(x."componentIds") v), x.unit, x.qty::numeric,
      x."unitPrice", x.amount
    from jsonb_to_recordset(${json(lines)}) as x(id uuid, ord smallint, name text, "productId" uuid,
      "componentIds" jsonb, unit text, qty text, "unitPrice" bigint, amount bigint)`;

type Settle = Parameters<TransactionsRepo["settleObligations"]>[1];
const settleQ = (t: string, id: string, o: Settle) => {
  const n = o.next;
  return sql`with c as (
      update contracts.obligations ob set status = 'cancelled', cancel_reason = left(${o.reason}::text, 200),
        updated_at = now()
      where ob.tenant_id = ${t}::uuid and ob.transaction_id = ${id}::uuid and ob.status = 'open'
        and ${o.reason}::text is not null
      returning ob.id),
    -- CTE ghi luôn chạy hết (không cần đọc kết quả). Huỷ (R32): sự kiện đối tác gắn nghĩa vụ của giao dịch ⇒ huỷ có lý do.
    v as (
      insert into contracts.partner_event_voids (event_id, tenant_id, by_user, reason)
      select e.id, e.tenant_id, ${ME}, left(${o.reason}::text, 500) from contracts.partner_events e
      where ${o.voidEvents}::boolean and e.tenant_id = ${t}::uuid
        and e.obligation_id in (select ob.id from contracts.obligations ob
          where ob.tenant_id = ${t}::uuid and ob.transaction_id = ${id}::uuid)
        and not exists (select 1 from contracts.partner_event_voids pv where pv.event_id = e.id and pv.tenant_id = e.tenant_id)
      returning 1)
    insert into contracts.obligations (tenant_id, transaction_id, party_key, direction, kind, seq, due_date, amount, source,
      title)
    select ${t}::uuid, ${id}::uuid, ${o.partyKey}::text, ${n?.direction ?? null}::text, 'payment', ${n?.seq ?? null}::int,
      ${n?.dueDate ?? null}::date, ${n?.amount ?? null}::bigint, 'manual', 'Thanh toán giao dịch'
    where ${n !== null}::boolean`;
};

const insertQ = (
  t: string,
  h: TxHeader,
) => sql`insert into contracts.transactions (tenant_id, deal, occurred_on,
    due_on, valid_until, partner_name, partner_tax_id, product_group, contract_id, note, holder, lot_label, total)
  values (${t}::uuid, ${h.deal}, ${h.occurred_on}::date, ${h.due_on}::date, ${h.valid_until}::date, ${h.partner_name},
    ${h.partner_tax_id}, ${h.product_group}, ${h.contract_id}::uuid, ${h.note}, ${h.holder}, ${h.lot_label},
    ${h.total}::bigint)
  returning id::text as id`;

type ReadPart = Pick<
  TransactionsRepo,
  "list" | "detail" | "lock" | "contractVisible" | "comps" | "lines" | "doneSum"
>;
function readPart(tx: Tx, t: string): ReadPart {
  return {
    list: (q) => one(tx, listQ(t, q)),
    detail: (id) => one(tx, detailQ(t, id)),
    lock: (id) => one<TxLocked | null>(tx, lockQ(t, id)),
    contractVisible: async (cid) =>
      (await one<boolean | null>(
        tx,
        sql`select exists (select 1 from contracts.contracts c
          where c.tenant_id = ${t}::uuid and c.id = ${cid}::uuid) as j`,
      )) === true,
    comps: async (ids) => (ids.length === 0 ? [] : one<DComp[]>(tx, compsQ(t, ids))),
    lines: (id, rev) => one<TxLineRow[]>(tx, linesQ(t, id, rev)),
    doneSum: async (id) =>
      Number(
        await one<string>(
          tx,
          sql`select coalesce(sum(o.amount), 0)::text as j from contracts.obligations o
            where o.tenant_id = ${t}::uuid and o.transaction_id = ${id}::uuid and o.status = 'done'`,
        ),
      ),
  };
}

export function transactionsRepo(tx: Tx, t: string): TransactionsRepo {
  return {
    ...readPart(tx, t),
    insert: async (h) => (await tx.execute<{ id: string }>(insertQ(t, h)))[0]?.id as string,
    update: async (id, patch) => {
      const sets = setList(patch);
      if (sets.length === 0) return;
      await tx.execute(sql`update contracts.transactions set ${sql.join(sets, sql`, `)}
        where tenant_id = ${t}::uuid and id = ${id}::uuid`);
    },
    writeLines: async (id, rev, lines, replace) => {
      if (replace)
        await tx.execute(sql`delete from contracts.transaction_lines
          where tenant_id = ${t}::uuid and transaction_id = ${id}::uuid and rev = 0`);
      if (lines.length > 0) await tx.execute(writeLinesQ(t, id, rev, lines));
    },
    remove: async (id) => {
      await tx.execute(
        sql`delete from contracts.transactions where tenant_id = ${t}::uuid and id = ${id}::uuid`,
      );
    },
    event: async (id, type, reason, data) => {
      await tx.execute(sql`insert into contracts.transaction_events (tenant_id, transaction_id, type, reason, data)
        values (${t}::uuid, ${id}::uuid, ${type}, ${reason}, ${json(data)})`);
    },
    applyStock: (moves, on, id) => applyDelivery(tx, moves, { tenantId: t, on, transactionId: id }),
    reverseStock: (id, on) => reverseTransactionStock(tx, t, id, on),
    settleObligations: async (id, o) => {
      await tx.execute(settleQ(t, id, o));
    },
  };
}
