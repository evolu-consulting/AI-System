// HD8-FR-03 · HD8-FR-04 · HD8-FR-05: câu GHI + đọc cấu hình của đối tác / điểm uy tín / báo giá — mỗi hàm MỘT câu văn bản cố định,
// lọc `tenant_id` tường minh ngoài RLS. Đọc chấm điểm (một câu lớn) ở `partners-data.repo.ts`.
import type { QuoteCreate } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PartyEv } from "../domain/partners.rules";
import type { Criterion, Role, Rules } from "../domain/scoring-config.rules";
import { json, one } from "./ledger-sql";
import { type PartnerData, partnerData, type StoredConfig } from "./partners-data.repo";

export type { PartnerData, StoredConfig };

const side = (c: string) =>
  sql.raw(`case when ${c}.direction = 'sale' then 'buyer' else 'supplier' end`);

export function partnersRepo(tx: Tx, t: string) {
  return {
    data: (today: string, months?: number) => partnerData(tx, t, today, months),
    /** Cấu hình đã lưu của vai (không khoá); chưa có ⇒ null. */
    config: (role: Role) =>
      one<StoredConfig | null>(
        tx,
        sql`select jsonb_build_object('role', s.role, 'version', s.version, 'criteria', s.criteria, 'rules', s.rules,
            'updated_by', contracts.user_label(s.updated_by), 'updated_at', s.updated_at) as j
          from contracts.score_configs s where s.tenant_id = ${t}::uuid and s.role = ${role}`,
      ),

    /** Khoá hàng cấu hình của vai (lưu tuần tự); chưa có ⇒ null. */
    lockConfig: (role: Role) =>
      one<StoredConfig | null>(
        tx,
        sql`select jsonb_build_object('role', s.role, 'version', s.version, 'criteria', s.criteria, 'rules', s.rules,
            'updated_by', null, 'updated_at', s.updated_at) as j
          from contracts.score_configs s where s.tenant_id = ${t}::uuid and s.role = ${role} for update`,
      ),

    /** `save_config`: cấu hình + một dòng lịch sử + ảnh chụp điểm mọi đối tác của vai, MỘT câu. */
    saveConfig: (w: {
      role: Role;
      version: number;
      by: string;
      criteria: readonly Criterion[];
      rules: Rules;
      summary: string;
      before: unknown;
      snapshots: { party: string; score: number | null; band: string | null }[];
    }) =>
      one<{ version: number; updated_at: string; updated_by: string | null }>(
        tx,
        sql`with c as (
          insert into contracts.score_configs (tenant_id, role, version, criteria, rules, updated_by, updated_at)
          values (${t}::uuid, ${w.role}, ${w.version}::int, ${json(w.criteria)}, ${json(w.rules)}, ${w.by}::uuid, now())
          on conflict (tenant_id, role) do update set version = excluded.version, criteria = excluded.criteria,
            rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at
          returning version, updated_at),
        h as (
          insert into contracts.score_config_history (tenant_id, role, version, by_user, summary, before, after)
          values (${t}::uuid, ${w.role}, ${w.version}::int, ${w.by}::uuid, ${w.summary}, ${json(w.before)},
            ${json({ criteria: w.criteria, rules: w.rules })})),
        s as (
          insert into contracts.score_snapshots (tenant_id, party_key, role, config_version, score, band)
          select ${t}::uuid, x.party, ${w.role}, ${w.version}::int, x.score, x.band
          from jsonb_to_recordset(${json(w.snapshots)}) as x (party text, score smallint, band text))
        select jsonb_build_object('version', c.version, 'updated_at', c.updated_at,
          'updated_by', contracts.user_label(${w.by}::uuid)) as j from c`,
      ),

    history: (role: Role) =>
      one<{ version: number; at: string; by: string | null; summary: string }[]>(
        tx,
        sql`select coalesce(jsonb_agg(jsonb_build_object('version', h.version, 'at', h.at,
            'by', contracts.user_label(h.by_user), 'summary', h.summary) order by h.version desc), '[]'::jsonb) as j
          from (select * from contracts.score_config_history h where h.tenant_id = ${t}::uuid and h.role = ${role}
            order by h.version desc limit 200) h`,
      ),

    /** Chấm tay: một dòng `rating` trên sổ; đối tác phải có HĐ người dùng thấy (như `visible_company`). */
    insertRating: (w: {
      party: string;
      role: Role;
      at: string;
      criterion: string;
      value: number;
      note: string | null;
    }) =>
      one<PartyEv | null>(
        tx,
        sql`with e as (
          insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, note, data)
          select ${t}::uuid, ${w.party}, ${w.role}, 'rating', ${w.at}::date,
            nullif(current_setting('app.user_id', true), '')::uuid, 'action', ${w.note}::text,
            jsonb_build_object('criterion', ${w.criterion}::text, 'value', ${w.value}::int, 'rated_at', now())
          where exists (select 1 from contracts.contracts c where c.tenant_id = ${t}::uuid and c.kind = 'contract'
            and contracts.party_key(c.fields -> (${side("c")} || '_name') ->> 'value',
              c.fields -> (${side("c")} || '_tax_id') ->> 'value') = ${w.party})
          returning *)
        select jsonb_build_object('id', e.id::text, 'value', ${w.value}::int, 'note', e.note,
          'by', contracts.user_label(e.by_user), 'at', e.at, 'rated_at', e.data ->> 'rated_at') as j from e`,
      ),

    /** Báo giá: NCC không MST ⇒ đối tác cùng tên (fold) nếu đã có trên HĐ (`compare.supplier_company`), không thì khoá theo tên. */
    insertQuote: (q: QuoteCreate & { product_name: string; unit: string | null }) =>
      one<{ id: string }>(
        tx,
        sql`with named as (
          select contracts.party_key(c.fields -> (s.side || '_name') ->> 'value', c.fields -> (s.side || '_tax_id') ->> 'value') as k
          from contracts.contracts c, lateral (values ('supplier'), ('buyer')) s (side)
          where c.tenant_id = ${t}::uuid and nullif(regexp_replace(coalesce(${q.supplier_tax_id ?? null}::text, ''), '[^0-9]', '', 'g'), '') is null
            and contracts.fold(c.fields -> (s.side || '_name') ->> 'value') = contracts.fold(${q.supplier_name}::text)
          order by c.created_at, c.id, s.side desc limit 1)
        insert into contracts.price_quotes (tenant_id, product_key, product_name, unit, supplier_name, supplier_tax_id,
          supplier_party_key, price, quoted_at, source, url, note, created_by)
        values (${t}::uuid, ${q.product}, ${q.product_name}, ${q.unit}, ${q.supplier_name}, ${q.supplier_tax_id ?? null},
          coalesce((select k from named), contracts.party_key(${q.supplier_name}::text, ${q.supplier_tax_id ?? null}::text)),
          ${q.price}::bigint, ${q.quoted_at}::date, ${q.url ? "website" : "quote"}, ${q.url ?? null}, ${q.note ?? null},
          nullif(current_setting('app.user_id', true), '')::uuid)
        returning jsonb_build_object('id', id) as j`,
      ),

    deleteQuote: async (id: string): Promise<boolean> =>
      (
        await tx.execute(
          sql`delete from contracts.price_quotes where tenant_id = ${t}::uuid and id = ${id}::uuid returning id`,
        )
      ).length > 0,
  };
}
export type PartnersRepo = ReturnType<typeof partnersRepo>;
