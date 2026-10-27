// CR-101 DOC-model · gắn/gỡ con của HĐ NT. Câu văn bản cố định, mảng id = MỘT tham số `{…}`, lọc `tenant_id` tường minh ngoài RLS
// (role `contracts_rw`, RLS FORCE + M1): HĐ NT / con không thấy ⇒ không có trong kết quả.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ChildRow, DocFrameRepo, FrameRow } from "../application/doc-frame.usecase";
import { one } from "./ledger-sql";

const uuidArr = (xs: readonly string[]) => sql`${`{${xs.join(",")}}`}::uuid[]`;

export function docFrameRepo(tx: Tx, t: string): DocFrameRepo {
  return {
    load: async (frameId, ids) => {
      const j = await one<{ frame: FrameRow | null; children: ChildRow[] | null }>(
        tx,
        sql`select json_build_object(
          'frame', (select json_build_object('root_id', f.root_id, 'doc_type', f.doc_type, 'partner_key', cur.partner_key,
              'direction', cur.direction)
            from contracts.contracts f
            left join lateral (select v.partner_key, v.direction from contracts.contracts v
              where v.tenant_id = f.tenant_id and v.root_id = f.root_id and v.superseded_at is null
              order by v.version_no limit 1) cur on true
            where f.tenant_id = ${t}::uuid and f.id = ${frameId}::uuid),
          'children', (select json_agg(json_build_object('id', k.id, 'root_id', k.root_id, 'doc_type', k.doc_type,
              'kind', k.kind, 'partner_key', k.partner_key, 'direction', k.direction))
            from contracts.contracts k where k.tenant_id = ${t}::uuid and k.id = any(${uuidArr(ids)}))) as j`,
      );
      return { frame: j?.frame ?? null, children: j?.children ?? [] };
    },
    attach: async (frameRoot, roots, userId) => {
      const rows = await tx.execute<{ root_id: string }>(sql`with u as (
          update contracts.contracts c set frame_root_id = ${frameRoot}::uuid
          where c.tenant_id = ${t}::uuid and c.root_id = any(${uuidArr(roots)})
            and c.frame_root_id is distinct from ${frameRoot}::uuid
          returning c.id, c.root_id, c.superseded_at),
        e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${t}::uuid, u.id, 'frame_attached', ${userId}::uuid, jsonb_build_object('frame_root_id', ${frameRoot}::uuid)
          from u where u.superseded_at is null)
        select distinct root_id::text from u`);
      return rows.map((r) => r.root_id);
    },
    detach: async (id, userId) => {
      const j = await one<{ found: boolean; n: number } | null>(
        tx,
        sql`with k as (select c.root_id, c.frame_root_id from contracts.contracts c
            where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid),
          u as (update contracts.contracts c set frame_root_id = null
            from k where c.tenant_id = ${t}::uuid and c.root_id = k.root_id and c.frame_root_id is not null
            returning c.id, c.superseded_at, k.frame_root_id as old),
          e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${t}::uuid, u.id, 'frame_detached', ${userId}::uuid, jsonb_build_object('frame_root_id', u.old)
            from u where u.superseded_at is null)
          select json_build_object('found', exists (select 1 from k), 'n', (select count(*) from u)) as j`,
      );
      return j?.found ? { detached: j.n > 0 } : null;
    },
  };
}
