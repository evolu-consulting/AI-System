// CR-152 · HĐ Nhượng quyền / Hợp tác vào DONE ⇒ sinh bộ mốc theo luật thuần `kind-schedule.rules.ts` (hook của port `ContractDoneHook`,
// đăng ký khoá "mốc-loại-HĐ" ở `extraction.mount.ts`). Hai câu SQL cố định bất kể số kỳ: ① đọc HĐ ② MỘT insert cho cả chuỗi (dữ liệu lô
// qua một tham số JSON). Idempotent: đã có mốc `default` còn hiệu lực (kể cả mốc chuyển từ phiên bản cũ, K5) ⇒ không sinh lại; mốc cùng
// (loại, hạn) với mốc AI đã lập (K7) ⇒ bỏ qua dòng đó. Lệnh HD7 mặc định bỏ qua hai loại này (MIGC 0112).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ContractDoneHook } from "../application/contract-done.ports";
import { kindMilestones } from "../domain/kind-schedule.rules";
import { isKindDeal, type Terms } from "../domain/kind-terms.rules";
import { DEFAULT_TENANT_TZ, localDate } from "../domain/local-time.rules";

type Row = {
  deal: string | null;
  kind_terms: Terms | string | null;
  start_date: string | null;
  end_date: string | null;
  signed: string | null;
  notice: string | null;
  party: string | null;
  rep_cell: number | null;
  has_default: boolean;
};

export const kindScheduleDoneHook: ContractDoneHook = {
  async onDone(txx, tid, contractId) {
    const tx = txx as Tx;
    const [c] =
      await tx.execute<Row>(sql`select c.deal, c.kind_terms, c.start_date::text as start_date,
        c.end_date::text as end_date, c.fields -> 'signed_date' ->> 'value' as signed,
        c.fields -> 'notice_days' ->> 'value' as notice, c.rep_cell,
        contracts.party_key(
          c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value',
          c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value') as party,
        exists (select 1 from contracts.obligations o where o.tenant_id = ${tid}::uuid and o.contract_id = c.id
          and o.source = 'default' and o.status <> 'replaced') as has_default
      from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid and c.status = 'done'`);
    if (!c || !isKindDeal(c.deal) || c.has_default) return;
    const terms =
      (typeof c.kind_terms === "string" ? JSON.parse(c.kind_terms) : c.kind_terms) ?? {};
    const notice = c.notice === null ? Number.NaN : Number(c.notice);
    const plan = kindMilestones({
      deal: c.deal,
      terms,
      start: c.start_date,
      end: c.end_date,
      signed: c.signed && /^\d{4}-\d{2}-\d{2}$/.test(c.signed) ? c.signed : null,
      noticeDays: Number.isFinite(notice) ? notice : null,
      today: localDate(new Date(), DEFAULT_TENANT_TZ),
    });
    if (plan.length === 0) return;
    const rows = plan.map((m, ord) => ({
      ord,
      direction: m.direction,
      kind: m.kind === "collect" || m.kind === "pay" ? "payment" : m.kind,
      due_date: m.due_date,
      amount: m.amount,
      title: m.title,
      owner: m.owner,
      period_key: m.period_key,
    }));
    await tx.execute(sql`with k as (
        select c.id, c.rep_cell, (select coalesce(max(o.seq), 0) from contracts.obligations o
          where o.tenant_id = ${tid}::uuid and o.contract_id = c.id) as top
        from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid)
      insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, title, owner,
        source, rep_cell, period_key)
      select ${tid}::uuid, k.id, ${c.party}, m.direction, m.kind, k.top + 1 + m.ord, m.due_date, m.amount, m.title, m.owner,
        'default', k.rep_cell, m.period_key
      from k, jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as m (ord int, direction text, kind text, due_date date,
        amount bigint, title text, owner text, period_key text)
      where not exists (select 1 from contracts.obligations o where o.tenant_id = ${tid}::uuid and o.contract_id = k.id
        and o.status <> 'cancelled' and o.status <> 'replaced' and o.kind = m.kind and o.due_date = m.due_date
        and o.direction = m.direction and o.period_key is null and m.period_key is null)`);
  },
};
