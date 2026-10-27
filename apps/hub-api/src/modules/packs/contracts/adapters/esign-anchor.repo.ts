// esign-anchor · repo trong tx `PackUow` (role `contracts_rw`, RLS tenant + M1): danh sách cụm của công ty (`approval_settings.esign_anchors`,
// NULL ⇒ mặc định), lưu + audit before/after; nguồn chữ của tệp HĐ hiện hành (`source_text` + tệp PDF + hướng mua/bán). Lọc `tenant_id`
// tường minh ngoài RLS. Một câu mỗi lệnh.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ESignAnchorRepo } from "../application/esign-anchor.usecase";
import type { AnchorLists } from "../domain/esign.anchor";

const listsOf = (v: unknown): AnchorLists | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as { a?: unknown; b?: unknown };
  const arr = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  const a = arr(o.a);
  const b = arr(o.b);
  return a.length > 0 && b.length > 0 ? { a, b } : null;
};

export function esignAnchorRepo(tx: Tx, t: string): ESignAnchorRepo {
  return {
    lists: async () => {
      const [r] = await tx.execute<{ v: unknown }>(sql`select s.esign_anchors as v
        from contracts.approval_settings s where s.tenant_id = ${t}::uuid`);
      return listsOf(r?.v);
    },
    saveLists: async (l, actor) => {
      const v = JSON.stringify(l);
      await tx.execute(sql`with old as (select s.esign_anchors as v
            from (select 1) one left join contracts.approval_settings s on s.tenant_id = ${t}::uuid),
          up as (insert into contracts.approval_settings (tenant_id, esign_anchors, updated_by)
            values (${t}::uuid, ${v}::jsonb, ${actor}::uuid)
            on conflict (tenant_id) do update set esign_anchors = excluded.esign_anchors,
              updated_by = excluded.updated_by, updated_at = now()
            returning esign_anchors)
        insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
          select ${t}::uuid, ${actor}::uuid, (select jsonb_build_object('esign_anchors', v) from old),
            jsonb_build_object('esign_anchors', up.esign_anchors)
          from up`);
    },
    source: async (id) => {
      const [r] = await tx.execute<{
        deal: string | null;
        direction: string | null;
        text: string | null;
        org: string | null;
        file_id: string | null;
        mime: string | null;
      }>(sql`select c.deal, c.direction, c.source_text as text, f.org, f.file_id, f.mime
        from contracts.contracts c
        left join contracts.files f on f.id = c.file_id and f.tenant_id = c.tenant_id and f.deleted_at is null
        where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid limit 1`);
      if (!r) return null;
      return {
        deal: r.deal,
        direction: r.direction,
        text: r.text,
        file: r.org && r.file_id ? { org: r.org, fileId: r.file_id, mime: r.mime ?? "" } : null,
      };
    },
  };
}
