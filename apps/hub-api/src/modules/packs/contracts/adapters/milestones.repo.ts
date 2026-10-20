// V2-A · HD-11 · Luật 4c: câu GHI của mốc HĐ. Tx do `PackUow` mở (RLS tenant); lọc `tenant_id` tường minh ngoài RLS. Khoá: hàng
// HĐ (`FOR NO KEY UPDATE`) rồi hàng mốc (`FOR UPDATE`) — hai câu riêng để thứ tự khoá bảo đảm (HD7 D7-15). Mỗi lệnh ghi = MỘT CTE
// (mốc + nhật ký HĐ + dữ liệu 5.4a của cả HĐ); số câu không phụ thuộc số mốc. Bảng chỉ thêm: xoá = `replaced` (REVOKE DELETE).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type {
  MilestoneRow,
  MilestonesRepo,
  MilestoneWrite,
  MilestoneWritten,
} from "../application/milestones.ports";
import { one } from "./ledger-sql";

/** JSON một mốc từ bí danh `o` (cột của `contracts.obligations`). */
export const msJson = (o: string) =>
  sql.raw(`jsonb_build_object('id', ${o}.id, 'contract_id', ${o}.contract_id, 'kind', ${o}.kind,
    'direction', ${o}.direction, 'title', ${o}.title, 'seq', ${o}.seq, 'due_date', ${o}.due_date, 'owner', ${o}.owner,
    'qty', ${o}.qty, 'amount', ${o}.amount, 'status', ${o}.status, 'done_at', ${o}.done_at, 'fault', ${o}.fault,
    'postponed_to', ${o}.postponed_to, 'source', ${o}.source)`);
/** Phần 5.4a của một mốc (đủ để chia giá trị). */
const peerJson = (o: string) =>
  sql.raw(`jsonb_build_object('id', ${o}.id, 'kind', ${o}.kind, 'direction', ${o}.direction, 'amount', ${o}.amount,
    'status', ${o}.status)`);

/** Đối tác của HĐ `c` (≡ `replaceSchedule` HD7): bán/giới thiệu ⇒ bên mua; mua ⇒ bên bán. */
const partyOf = (c: string) =>
  sql.raw(`contracts.party_key(
    ${c}.fields -> (case when ${c}.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
    ${c}.fields -> (case when ${c}.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value')`);

/** Câu cuối: mốc vừa ghi (`u`) + mốc còn hiệu lực khác của HĐ (ảnh chụp đầu câu ⇒ loại `u.id`, ghép `u`) + tiền của HĐ. */
function written(t: string): SQL {
  return sql`select jsonb_build_object('m', ${msJson("u")}, 'deal', k.deal, 'value', k.value,
      'pct', k.commission_pct, 'fixed', k.commission_fixed,
      'peers', (select jsonb_agg(p.j) from (
          select ${peerJson("o")} as j from contracts.obligations o
          where o.tenant_id = ${t}::uuid and o.contract_id = u.contract_id and o.status <> 'replaced' and o.id <> u.id
          union all select ${peerJson("u")}) p)) as j
    from u join contracts.contracts k on k.tenant_id = ${t}::uuid and k.id = u.contract_id`;
}
/** Huỷ dòng quá hạn (hệ thống) của mốc ở `u` khi `on` (hạn dời / mốc gỡ) — sổ chỉ thêm. */
const voidOverdue = (t: string, on: boolean) => sql`vo as (
    insert into contracts.partner_event_voids (event_id, tenant_id, by_user)
    select e.id, e.tenant_id, null from contracts.partner_events e join u on e.obligation_id = u.id
    where e.tenant_id = ${t}::uuid and e.type = 'overdue' and ${on}::boolean
    on conflict (event_id, tenant_id) do nothing)`;
const audit = (t: string, type: string, by: string, data: SQL) => sql`a as (
    insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
    select ${t}::uuid, u.contract_id, ${type}, ${by}::uuid, ${data} from u)`;

export function milestonesRepo(tx: Tx, t: string): MilestonesRepo {
  return {
    lockContract: async (id) => {
      const [r] = await tx.execute<{ deal: string | null; n: number }>(sql`select c.deal,
          (select count(*)::int from contracts.obligations o
            where o.tenant_id = ${t}::uuid and o.contract_id = c.id and o.status <> 'replaced') as n
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid for no key update of c`);
      return r ? { deal: r.deal as never, n: r.n } : null;
    },
    lockContractOf: async (id) => {
      const [r] = await tx.execute<{
        deal: string | null;
      }>(sql`select c.deal from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = (select o.contract_id from contracts.obligations o
          where o.id = ${id}::uuid and o.tenant_id = ${t}::uuid and o.status <> 'replaced')
        for no key update`);
      return r ? { deal: r.deal as never } : null;
    },
    lockRow: (id) =>
      one<MilestoneRow | null>(
        tx,
        sql`select ${msJson("o")} as j from contracts.obligations o
          where o.id = ${id}::uuid and o.tenant_id = ${t}::uuid and o.status <> 'replaced' for update`,
      ),
    insert: (contractId, w, by) =>
      one<MilestoneWritten>(
        tx,
        sql`with k as (
          select c.id, ${partyOf("c")} as party,
            (select coalesce(max(o.seq), 0) from contracts.obligations o
              where o.tenant_id = ${t}::uuid and o.contract_id = c.id) as top
          from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid),
        u as (
          insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount,
            qty, title, owner, source)
          select ${t}::uuid, k.id, k.party, ${w.direction}, ${w.kind}, k.top + 1, ${w.due_date}::date, ${w.amount}::bigint,
            ${w.qty}::numeric, ${w.title}, ${w.owner}, 'manual' from k
          returning *),
        ${audit(t, "milestone_added", by, sql`jsonb_build_object('milestone_id', u.id, 'kind', u.kind)`)}
        ${written(t)}`,
      ),
    update: (id, w, by) => one<MilestoneWritten>(tx, updateQ(t, id, w, by)),
    remove: async (id, by) => {
      const [r] = await tx.execute<{ n: number }>(sql`with u as (
          update contracts.obligations o set status = 'replaced', updated_at = now()
          where o.tenant_id = ${t}::uuid and o.id = ${id}::uuid and o.status in ('open', 'cancelled')
          returning o.id, o.contract_id),
        ${voidOverdue(t, true)},
        ${audit(t, "milestone_deleted", by, sql`jsonb_build_object('milestone_id', u.id)`)}
        select count(*)::int as n from u`);
      return (r?.n ?? 0) > 0;
    },
  };
}

function updateQ(t: string, id: string, w: MilestoneWrite & { moved: boolean }, by: string): SQL {
  return sql`with u as (
      update contracts.obligations o set kind = ${w.kind}, direction = ${w.direction}, title = ${w.title},
        owner = ${w.owner}, due_date = ${w.due_date}::date, qty = ${w.qty}::numeric, amount = ${w.amount}::bigint,
        updated_at = now()
      where o.tenant_id = ${t}::uuid and o.id = ${id}::uuid and o.status in ('open', 'cancelled')
      returning o.*),
    ${voidOverdue(t, w.moved)},
    ${audit(t, "milestone_edited", by, sql`jsonb_build_object('milestone_id', u.id, 'kind', u.kind, 'due_date', u.due_date)`)}
    ${written(t)}`;
}
