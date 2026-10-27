// MS-impact · Luật 4c: MỘT câu đọc mọi thứ của MỘT đợt cần cho xem trước tác động (mốc + công nợ mở của HĐ + dòng "Quá hạn" treo của
// đợt), dưới RLS người gọi (đợt của HĐ không thấy ⇒ null ⇒ 404). Chỉ mục: khoá chính đợt, `obligations(contract_id)`,
// `partner_events_obligation_idx` — không quét đối tác/tenant.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ImpactHead } from "../domain/obligation-impact.rules";
import { one } from "./ledger-sql";

export function obligationImpactRepo(tx: Tx, t: string) {
  return {
    head: (id: string) =>
      one<ImpactHead | null>(
        tx,
        sql`select jsonb_build_object('id', o.id, 'contract_id', o.contract_id, 'status', o.status, 'kind', o.kind,
            'direction', o.direction, 'owner', o.owner, 'due_date', o.due_date, 'amount', o.amount, 'party', o.party_key,
            'rep_cell', o.rep_cell,
            'debt_open', coalesce((select sum(coalesce(d.amount, 0)) from contracts.obligations d
              where d.tenant_id = o.tenant_id and d.contract_id = o.contract_id and d.status = 'open'
                and d.direction = o.direction and d.kind in ('payment', 'commission')), 0),
            'overdue', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'due_date', e.data ->> 'due_date'))
              from contracts.partner_events e
              where e.tenant_id = o.tenant_id and e.obligation_id = o.id and e.type = 'overdue'
                and e.data ->> 'party_late' = 'true'
                and (e.role = 'supplier') = coalesce(e.data ->> 'kind' = 'delivery', false)
                and not exists (select 1 from contracts.partner_event_voids v where v.tenant_id = e.tenant_id and v.event_id = e.id)
                and not exists (select 1 from contracts.partner_events s where s.tenant_id = e.tenant_id
                  and s.obligation_id = e.obligation_id and s.role = e.role and s.type = 'postponed' and s.at >= e.at
                  and not exists (select 1 from contracts.partner_event_voids v2
                    where v2.tenant_id = s.tenant_id and v2.event_id = s.id))), '[]'::jsonb)) as j
          from contracts.obligations o
          where o.tenant_id = ${t}::uuid and o.id = ${id}::uuid and o.status <> 'replaced'`,
      ),
  };
}
export type ObligationImpactRepo = ReturnType<typeof obligationImpactRepo>;
