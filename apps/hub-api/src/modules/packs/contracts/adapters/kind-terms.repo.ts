// CR-152 · SQL của trường riêng + kỳ doanh thu / đối soát (Nhượng quyền, Hợp tác). Tx do `PackUow` mở (role `contracts_rw`, RLS FORCE);
// `tenant_id` tường minh ngoài RLS. Mỗi thao tác = MỘT câu văn bản hằng, không phụ thuộc số kỳ.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { KindContract, KindTermsRepo } from "../application/kind-terms.usecase";
import type { PeriodRow } from "../domain/kind-schedule.rules";

const json = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export function kindTermsRepo(tx: Tx, t: string): KindTermsRepo {
  return {
    async lock(id) {
      const [r] = await tx.execute<{
        deal: string | null;
        status: string;
        kind_terms: unknown;
        start_date: string | null;
        end_date: string | null;
      }>(sql`select c.deal, c.status, c.kind_terms, c.start_date::text as start_date, c.end_date::text as end_date
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid for no key update of c`);
      if (!r) return null;
      return {
        deal: r.deal,
        status: r.status,
        terms: (json(r.kind_terms) ?? {}) as KindContract["terms"],
        start: r.start_date,
        end: r.end_date,
      };
    },
    async saveTerms(id, terms, direction, userId) {
      await tx.execute(sql`with u as (
          update contracts.contracts set kind_terms = ${JSON.stringify(terms)}::jsonb, direction = ${direction}, updated_at = now()
          where id = ${id}::uuid and tenant_id = ${t}::uuid and status = 'draft' and deal in ('franchise', 'cooperation')
          returning id)
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${t}::uuid, u.id, 'kind_terms_saved', ${userId}::uuid, jsonb_build_object('keys', ${JSON.stringify(Object.keys(terms))}::jsonb)
        from u`);
    },
    async periodRows(id) {
      const rows = await tx.execute<{
        id: string;
        period_key: string;
        kind: string;
        status: PeriodRow["status"];
        due_date: string;
        amount: string | number | null;
        period_figure: string | number | null;
      }>(sql`select o.id, o.period_key, o.kind, o.status, o.due_date::text as due_date, o.amount, o.period_figure
        from contracts.obligations o
        where o.tenant_id = ${t}::uuid and o.contract_id = ${id}::uuid and o.period_key is not null and o.status <> 'replaced'
        order by o.period_key, o.seq`);
      return rows.map((r) => ({
        id: r.id,
        period_key: r.period_key,
        kind: r.kind,
        status: r.status,
        due_date: r.due_date,
        amount: num(r.amount),
        period_figure: num(r.period_figure),
      }));
    },
    async recordPeriod(id, key, w, userId) {
      const [r] = await tx.execute<{ n: number }>(sql`with u as (
          update contracts.obligations o set
            period_figure = case when o.kind = 'other' then ${w.figure}::bigint else o.period_figure end,
            amount = case when o.kind = 'payment' and o.status = 'open' and ${w.fee}::bigint is not null then ${w.fee}::bigint else o.amount end,
            status = case when o.kind = 'other' and o.status = 'open' then 'done' else o.status end,
            done_at = case when o.kind = 'other' and o.status = 'open'
              then (now() at time zone 'Asia/Ho_Chi_Minh')::date else o.done_at end,
            updated_at = now()
          where o.tenant_id = ${t}::uuid and o.contract_id = ${id}::uuid and o.period_key = ${key}
            and o.status in ('open', 'done') and o.kind in ('other', 'payment')
          returning o.id, o.kind),
        e as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, ${id}::uuid, 'period_recorded', ${userId}::uuid,
            jsonb_build_object('period', ${key}::text, 'figure', ${w.figure}::bigint, 'fee', ${w.fee}::bigint)
          where exists (select 1 from u))
        select count(*) filter (where kind = 'other')::int as n from u`);
      return r?.n ?? 0;
    },
  };
}
