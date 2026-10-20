// R1 · đọc phục vụ nạp, trong tx `knowledge_rw` (RLS FORCE) + lọc `tenant_id` tường minh. Một câu, dữ liệu qua MỘT tham số jsonb.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ExistingEntity, IngestReadRepo } from "../application/ports";
import { aliasPairKey as pairKey } from "../domain/extract.rules";

export function ingestRepo(tx: Tx, tid: string): IngestReadRepo {
  return {
    async aliasCandidates(probes) {
      if (probes.length === 0) return [];
      const json = JSON.stringify(probes.slice(0, 200));
      const rows = await tx.execute<ExistingEntity>(sql`select distinct e.key, e.name, e.type
        from jsonb_to_recordset(${json}::jsonb) as p(type text, q text)
        join knowledge.entities e on e.tenant_id = ${tid}::uuid and e.type = p.type
          and to_tsvector('knowledge.vi', knowledge.fold(e.name)) @@ plainto_tsquery('knowledge.vi', knowledge.fold(p.q))
        order by e.key limit 200`);
      return rows.map((r) => ({ key: r.key, name: r.name, type: r.type }));
    },

    async aliasedPairs(pairs) {
      if (pairs.length === 0) return new Set();
      const json = JSON.stringify(pairs.slice(0, 200).map((p) => ({ a: p.a, b: p.b })));
      const rows = await tx.execute<{ a: string; b: string }>(sql`select p.a, p.b
        from jsonb_to_recordset(${json}::jsonb) as p(a text, b text)
        join knowledge.entities x on x.tenant_id = ${tid}::uuid and x.key = p.a
        join knowledge.entities y on y.tenant_id = ${tid}::uuid and y.key = p.b
        join knowledge.entity_aliases al on al.tenant_id = ${tid}::uuid
          and al.a_id = least(x.id, y.id) and al.b_id = greatest(x.id, y.id)`);
      return new Set(rows.map((r) => pairKey(r.a, r.b)));
    },

    async hasGraph(docId) {
      const rows = await tx.execute<{ ok: boolean }>(sql`select
        exists (select 1 from knowledge.chunk_entities ce
          join knowledge.chunks c on c.tenant_id = ${tid}::uuid and c.id = ce.chunk_id
          where ce.tenant_id = ${tid}::uuid and c.doc_id = ${docId}::uuid)
        or exists (select 1 from knowledge.chunk_links l
          where l.tenant_id = ${tid}::uuid and (l.src_doc_id = ${docId}::uuid or l.dst_doc_id = ${docId}::uuid))
        or exists (select 1 from knowledge.document_links dl
          where dl.tenant_id = ${tid}::uuid and dl.src_id = ${docId}::uuid) as ok`);
      return rows[0]?.ok === true;
    },
  };
}
