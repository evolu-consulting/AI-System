// HD7-FR-09 · HD7-NFR-03 · D7-14: MỘT câu CTE của vòng quá hạn — chọn theo index một phần `obligations_overdue_idx` (đợt mở có đối
// tác, chưa ghi cho hạn hiện tại), khoá `FOR UPDATE SKIP LOCKED`, đặt `overdue_for = due_date`, thêm sổ `overdue` (hệ thống). Văn bản
// cố định; `party_late` = (thu ∧ tiền) ∨ (trả ∧ hàng) ≡ `ledger.rules.ts::overdueOf`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { OverdueRepo } from "../application/overdue-sweep";
import { confirmedOf } from "./ledger-sql";

export function overdueRepo(tx: Tx, t: string): OverdueRepo {
  return {
    async sweep(today, limit) {
      const [r] = await tx.execute<{ n: number }>(sql`with late as (
          select o.id from contracts.obligations o
          where o.tenant_id = ${t}::uuid and o.status = 'open' and o.party_key is not null
            and o.overdue_for is distinct from o.due_date and o.due_date < ${today}::date and ${confirmedOf("o", t)}
          order by o.due_date, o.id limit ${limit}::int
          for update skip locked),
        u as (
          update contracts.obligations o set overdue_for = o.due_date
          from late where o.id = late.id and o.tenant_id = ${t}::uuid
          returning o.id, o.contract_id, o.party_key, o.direction, o.kind, o.seq, o.due_date, o.amount),
        e as (
          insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id,
            obligation_id, amount, data)
          select ${t}::uuid, u.party_key, case when u.direction = 'receive' then 'customer' else 'supplier' end,
            'overdue', u.due_date + 1, null, 'system', u.contract_id, u.id, u.amount,
            jsonb_build_object('due_date', u.due_date, 'kind', u.kind, 'seq', u.seq,
              'party_late', (u.direction = 'receive' and u.kind = 'payment') or (u.direction = 'pay' and u.kind = 'delivery'))
          from u returning 1)
        select count(*)::int as n from e`);
      return Number(r?.n ?? 0);
    },
  };
}
