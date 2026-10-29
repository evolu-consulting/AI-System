// CR-103 · fnr-if · dữ kiện đánh giá node If trong MỘT câu (Luật 4c: không phụ thuộc số stage/điều kiện): fields output hiện
// hành của mọi stage (`stage_idx` ⇒ object) + input run (`key` ⇒ giá trị). Lọc `tenant_id`; chạy trong tx đã khoá run.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { IfFacts } from "../../application/ports";

type Row = { fields: unknown; inputs: unknown };
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const scalar = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";

export async function ifFacts(tx: Tx, tenantId: string, runId: string): Promise<IfFacts> {
  const [r] = await tx.execute<Row>(sql`select
      (select coalesce(jsonb_object_agg(s.stage_idx::text, o.fields), '{}'::jsonb)
         from hub.stage_runs s
         join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
        where s.process_run_id = r.id and s.tenant_id = r.tenant_id and jsonb_typeof(o.fields) = 'object') as fields,
      (select coalesce(jsonb_object_agg(v->>'key', coalesce(v->'value', v->'text')), '{}'::jsonb)
         from jsonb_array_elements(
           case when jsonb_typeof(r.inputs) = 'array' then r.inputs else '[]'::jsonb end) v
        where v->>'key' is not null) as inputs
    from hub.process_runs r where r.id = ${runId} and r.tenant_id = ${tenantId}`);
  const fieldsByIdx: Record<string, Record<string, string | number>> = {};
  if (isObj(r?.fields))
    for (const [idx, f] of Object.entries(r.fields))
      if (isObj(f))
        fieldsByIdx[idx] = Object.fromEntries(
          Object.entries(f).filter(([, x]) => scalar(x)),
        ) as Record<string, string | number>;
  const inputs: Record<string, string | number> = {};
  if (isObj(r?.inputs)) for (const [k, v] of Object.entries(r.inputs)) if (scalar(v)) inputs[k] = v;
  return { fieldsByIdx, inputs };
}
