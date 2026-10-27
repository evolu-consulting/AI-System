// CR-101 DOC-deals · câu SQL của Giao dịch là chứng từ: nâng thành HĐ (MỘT CTE: khoá hàng + files + UPDATE + event), mốc của chứng từ
// (xác nhận ngay khi lưu), lịch sử sửa (`contract_edit_log`), lớp tương thích `/transactions` (đọc). Mỗi hàm MỘT câu văn bản cố định,
// `tenant_id` tường minh ngoài RLS (role `contracts_rw`, RLS FORCE + M1).

import type { TransactionListQuery } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PromoteRepo, PromoteRow } from "../application/promote-contract.usecase";
import type { DealMilestone } from "../domain/deal.rules";
import { detailQ, listQ } from "./transactions-read.sql";

const fv = (v: string) =>
  sql`jsonb_build_object('value', ${v}::text, 'quote', '', 'verified', true, 'edited', true)`;

export function promoteRepo(tx: Tx, t: string): PromoteRepo {
  return {
    async promote(w) {
      const rows = await tx.execute<PromoteRow>(sql`with cur as (
          select c.id, c.doc_type, c.superseded_at is not null as superseded from contracts.contracts c
          where c.tenant_id = ${t}::uuid and c.id = ${w.id}::uuid for update),
        f as (
          insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
          select ${w.fileRowId}::uuid, ${t}::uuid, ${w.org}, ${w.fileId}, ${w.versionId}, ${w.name}, ${w.mime},
            ${w.size}::bigint, ${w.userId}::uuid
          from cur where cur.doc_type = 'deal' and not cur.superseded
          returning id),
        -- Review cuối đợt (lách duyệt): tenant BẬT duyệt ⇒ HĐ về needs_review (không khoá; người gọi mở lượt duyệt cấp 1 —
        -- engine/máy như nhập tay); TẮT ⇒ confirmed_* = người nâng ⇒ K1 (BEFORE) khoá ngay, locked_by = người nâng.
        s as (select contracts.approval_on() as on),
        u as (
          update contracts.contracts c set doc_type = 'contract', file_id = f.id,
            fields = c.fields || jsonb_build_object('number', ${fv(w.number)}), version = c.version + 1, updated_at = now(),
            status = case when s.on then 'needs_review' else c.status end,
            confirmed_at = case when s.on then null else now() end,
            confirmed_by = case when s.on then null else ${w.userId}::uuid end
          from f, s where c.tenant_id = ${t}::uuid and c.id = ${w.id}::uuid
          returning c.id, c.version, c.status, c.locked_at is not null as locked),
        e as (
          insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, u.id, 'promoted', ${w.userId}::uuid,
            jsonb_build_object('file_id', ${w.fileRowId}::uuid, 'number', ${w.number}::text) from u)
        select cur.doc_type, coalesce(cur.superseded, false) as superseded, u.version, u.status,
          coalesce(u.locked, false) as locked
        from (select 1) one left join cur on true left join u on true`);
      return (
        rows[0] ?? { doc_type: null, superseded: false, version: null, status: null, locked: false }
      );
    },
    async check(id) {
      const rows = await tx.execute<{
        doc_type: string;
        superseded: boolean;
      }>(sql`select c.doc_type,
          c.superseded_at is not null as superseded
        from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid`);
      return rows[0] ?? null;
    },
  };
}

export type DealsRepo = {
  milestones(id: string): Promise<DealMilestone[]>;
  /** null ⇒ chứng từ không có / không thấy. */
  editLog(id: string, limit: number): Promise<unknown[] | null>;
  legacyList(q: TransactionListQuery): Promise<unknown>;
  legacyDetail(id: string): Promise<unknown | null>;
};

export function dealsRepo(tx: Tx, t: string): DealsRepo {
  const one = async (q: ReturnType<typeof sql>) =>
    (await tx.execute<{ j: unknown }>(q))[0]?.j ?? null;
  return {
    async milestones(id) {
      return tx.execute<DealMilestone>(sql`select o.id::text, o.kind, o.status from contracts.obligations o
        where o.tenant_id = ${t}::uuid and o.contract_id = ${id}::uuid order by o.seq, o.created_at`);
    },
    async editLog(id, limit) {
      const j = await one(sql`select case when exists (select 1 from contracts.contracts c
            where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid)
          then coalesce((select jsonb_agg(s.x order by s.n desc) from (
            select l.id as n, jsonb_build_object('id', l.id::text, 'at', l.at, 'actor_user_id', l.actor_user_id,
              'field', l.field, 'old_value', l.old_value, 'new_value', l.new_value) as x
            from contracts.contract_edit_log l where l.tenant_id = ${t}::uuid and l.contract_id = ${id}::uuid
            order by l.id desc limit ${limit}::int) s(n, x)), '[]'::jsonb) end as j`);
      return j as unknown[] | null;
    },
    legacyList: (q) => one(listQ(t, q)),
    legacyDetail: (id) => one(detailQ(t, id)),
  };
}
