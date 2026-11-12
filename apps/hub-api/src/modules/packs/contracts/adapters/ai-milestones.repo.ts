// CR-127 · K7 · BR-43 · spec §2.2/§6: HĐ vào DONE ⇒ lập mốc từ các mốc AI đã đọc (`ai_read.milestones`: giao / thu / trả / hoa hồng /
// serial / báo gia hạn…) kèm điều khoản gốc (`clause_ref`, `page`). Hook của port `ContractDoneHook` (đăng ký khoá "mốc-AI" ở
// `extraction.mount.ts`, không ghi đè hook gia hạn K6). MỘT câu SQL theo tập (Luật 4c).
// Idempotent + không đôi: `seq` = số thứ tự mốc trong danh sách AI (1-based); bỏ mốc đã có cùng (kind, seq) HOẶC cùng (kind, hạn)
// ở HĐ này (kể cả mốc chuyển từ phiên bản cũ — K5, BR-36b). Mốc AI không có hạn ⇒ không lập (người phụ trách thêm tay).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ContractDoneHook } from "../application/contract-done.ports";

export const aiMilestonesDoneHook: ContractDoneHook = {
  async onDone(txx, tid, contractId) {
    const tx = txx as Tx;
    await tx.execute(sql`with c as (
        select c.id, c.rep_cell, c.deal, c.ai_read,
          contracts.party_key(
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
            c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value') as party
        from contracts.contracts c
        where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid and c.status = 'done'
          and jsonb_typeof(c.ai_read -> 'milestones') = 'array'),
      m as (
        select c.id, c.rep_cell, c.party, e.ord::int as seq, x.kind as ai_kind, x.title, x.due_date::date as due_date,
          x.amount, x.clause_ref, x.page,
          case when x.kind in ('collect', 'pay') then 'payment' else x.kind end as kind,
          case when x.kind = 'collect' then 'receive' when x.kind = 'pay' then 'pay'
            when c.deal = 'buy' then 'pay' else 'receive' end as direction
        from c, jsonb_array_elements(c.ai_read -> 'milestones') with ordinality as e (v, ord),
          jsonb_to_record(e.v) as x (kind text, title text, due_date text, amount bigint, clause_ref text, page int)
        where x.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, title,
        source, rep_cell, clause_ref, page)
      select ${tid}::uuid, m.id, m.party, m.direction, m.kind, m.seq, m.due_date,
        case when m.ai_kind in ('collect', 'pay', 'commission') then m.amount end, m.title, 'ai', m.rep_cell, m.clause_ref, m.page
      from m
      where m.seq between 1 and 9999
        and not exists (select 1 from contracts.obligations o
          where o.tenant_id = ${tid}::uuid and o.contract_id = m.id and o.status <> 'cancelled'
            and o.kind = m.kind and (o.seq = m.seq or o.due_date = m.due_date))`);
  },
};
