// G1 · Luật 4c: hai câu lớn của đồ thị tách khỏi `graph.repo.ts` — vùng lân cận một tài liệu (MỘT câu thay 5 câu Cypher) và
// thống kê (MỘT câu thay 3 câu `routes/stats.py`). Mỗi CTE đi index (tenant_id, …) của bảng cạnh; không quét cả tenant.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { GraphStats } from "../application/graph.ports";

/** Hàng `NbRow`: doc | mention | rel | alias | doclink (SIMILAR/CONFLICTS gộp theo tài liệu, rồi LINKS_TO hai chiều). */
export const nbSql = (tid: string, docId: string): SQL => sql`with
    d as materialized (select id, title from knowledge.documents where tenant_id = ${tid}::uuid and id = ${docId}::uuid),
    ch as materialized (select c.id from knowledge.chunks c, d where c.tenant_id = ${tid}::uuid and c.doc_id = d.id),
    me as materialized (select distinct ce.entity_id as id from knowledge.chunk_entities ce
      where ce.tenant_id = ${tid}::uuid and ce.chunk_id in (select id from ch)),
    mk as materialized (select e.id, e.key, e.name, e.type from knowledge.entities e
      where e.tenant_id = ${tid}::uuid and e.id in (select id from me)),
    rel as (select distinct a.key as src, b.key as dst, b.name, b.type, r.type as ltype
      from knowledge.entity_rels r join mk a on a.id = r.src_id
        join knowledge.entities b on b.tenant_id = ${tid}::uuid and b.id = r.dst_id
      where r.tenant_id = ${tid}::uuid),
    al as (select distinct a.key as src, b.key as dst, b.name, b.type from (
        select x.a_id as s, x.b_id as t from knowledge.entity_aliases x
          where x.tenant_id = ${tid}::uuid and x.a_id in (select id from me)
        union all select x.b_id, x.a_id from knowledge.entity_aliases x
          where x.tenant_id = ${tid}::uuid and x.b_id in (select id from me)) p
      join mk a on a.id = p.s join knowledge.entities b on b.tenant_id = ${tid}::uuid and b.id = p.t),
    sim as (select distinct z.doc, z.kind from (
        select l.dst_doc_id as doc, l.kind from knowledge.chunk_links l, d
          where l.tenant_id = ${tid}::uuid and l.src_doc_id = d.id and l.dst_doc_id <> d.id
        union all select l.src_doc_id, l.kind from knowledge.chunk_links l, d
          where l.tenant_id = ${tid}::uuid and l.dst_doc_id = d.id and l.src_doc_id <> d.id) z),
    lk as (select dl.dst_id as doc from knowledge.document_links dl, d where dl.tenant_id = ${tid}::uuid and dl.src_id = d.id
      union select dl.src_id from knowledge.document_links dl, d where dl.tenant_id = ${tid}::uuid and dl.dst_id = d.id)
  select 'doc' as row, d.id::text as src, null::text as dst, d.title as label, 'Document' as ntype, null::text as ltype
    from d
  union all select 'mention', d.id::text, mk.key, mk.name, mk.type, 'MENTIONS' from mk, d
  union all select 'rel', src, dst, name, type, ltype from rel
  union all select 'alias', src, dst, name, type, 'ALIAS_OF' from al
  union all select 'doclink', ${docId}, x.id::text, x.title, 'Document', sim.kind
    from sim join knowledge.documents x on x.tenant_id = ${tid}::uuid and x.id = sim.doc
  union all select 'doclink', ${docId}, x.id::text, x.title, 'Document', 'LINKS_TO'
    from lk join knowledge.documents x on x.tenant_id = ${tid}::uuid and x.id = lk.doc`;

type StatRow = { k: "type" | "alias" | "SIMILAR" | "CONFLICTS"; t: string | null; n: number };

/** Thực thể theo loại + số cặp bí danh + số CẶP tài liệu (không phải hợp đồng) có CONFLICTS / SIMILAR. */
export async function graphStats(tx: Tx, tid: string): Promise<GraphStats> {
  const rows = await tx.execute<StatRow>(sql`with docs as materialized (
      select id from knowledge.documents where tenant_id = ${tid}::uuid and kind <> 'contract')
    select 'type' as k, type as t, count(*)::int as n from knowledge.entities where tenant_id = ${tid}::uuid group by type
    union all select 'alias', null, count(*)::int from knowledge.entity_aliases where tenant_id = ${tid}::uuid
    union all select p.kind, null, count(*)::int from (
        select l.kind, least(l.src_doc_id, l.dst_doc_id), greatest(l.src_doc_id, l.dst_doc_id)
        from knowledge.chunk_links l
        where l.tenant_id = ${tid}::uuid and l.src_doc_id <> l.dst_doc_id
          and l.src_doc_id in (select id from docs) and l.dst_doc_id in (select id from docs)
        group by 1, 2, 3) p
      group by p.kind`);
  const byType: Record<string, number> = {};
  let aliasPairs = 0;
  const links = { conflicts: 0, duplicates: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.k === "type" && r.t !== null) byType[r.t] = n;
    else if (r.k === "alias") aliasPairs = n;
    else if (r.k === "CONFLICTS") links.conflicts = n;
    else if (r.k === "SIMILAR") links.duplicates = n;
  }
  const total = Object.values(byType).reduce((s, n) => s + n, 0);
  return { entities: { total, byType, aliasPairs }, links };
}
