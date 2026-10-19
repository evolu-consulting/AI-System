// R1 · đọc phục vụ nạp, trong tx `knowledge_rw` (RLS FORCE) + lọc `tenant_id` tường minh. Một câu, dữ liệu qua MỘT tham số jsonb.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ExistingEntity, IngestReadRepo } from "../application/ports";

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
  };
}
