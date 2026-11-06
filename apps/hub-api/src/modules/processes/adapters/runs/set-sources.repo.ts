// CR-122 · E4 · nguồn của node `set` lúc chạy (trong tx đã khoá run, mọi câu lọc `tenant_id`): field output hiện hành của các BƯỚC
// trước (1 câu, chỉ khi có nguồn field) + dữ kiện HIỆN TẠI của bản ghi qua `FactsReader` (≤ 1 lần, chỉ khi có nguồn fact) + audit giá
// trị sai dạng (1 câu, chỉ khi có). Không nguồn field/fact ⇒ 0 câu thêm (đường cũ input/hằng giữ nguyên).
import { resolveSteps } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SetExec, SetRaw, SetSources } from "../../domain/set/set.rules";
import { factsReaderFor } from "./flow-ports";

type Head = {
  snapshot: { trigger?: { event?: string }; stages?: { step?: number }[] } | null;
  pack_key: string | null;
  pack_record_id: string | null;
  fields: Record<string, Record<string, SetRaw>> | null;
};
const isObj = (v: unknown): v is Record<string, SetRaw> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Field theo bước: stage nhỏ nhất của bước có field đó thắng (bước song song: cùng khoá ⇒ stage đầu). */
function byStep(steps: readonly number[], fieldsByIdx: Head["fields"]) {
  const out: Record<number, Record<string, SetRaw>> = {};
  steps.forEach((st, i) => {
    const f = fieldsByIdx?.[String(i)];
    if (!isObj(f)) return;
    const row = out[st] ?? {};
    for (const [k, v] of Object.entries(f)) if (!Object.hasOwn(row, k)) row[k] = v;
    out[st] = row;
  });
  return out;
}

export async function setSourcesOf(
  tx: Tx,
  x: { tenantId: string; runId: string; exec: SetExec; inputs: SetSources["inputs"] },
): Promise<SetSources> {
  const kinds = new Set(x.exec.values.map((v) => ("kind" in v.from ? v.from.kind : "")));
  if (!kinds.has("field") && !kinds.has("fact")) return { inputs: x.inputs };
  const [h] = await tx.execute<Head>(sql`select r.snapshot, r.pack_key, r.pack_record_id,
      (select coalesce(jsonb_object_agg(s.stage_idx::text, o.fields), '{}'::jsonb)
         from hub.stage_runs s
         join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
        where s.process_run_id = r.id and s.tenant_id = r.tenant_id and s.status = 'done'
          and jsonb_typeof(o.fields) = 'object') as fields
    from hub.process_runs r where r.id = ${x.runId} and r.tenant_id = ${x.tenantId}`);
  const steps = resolveSteps(h?.snapshot?.stages ?? []);
  const fieldsByStep = byStep(steps, h?.fields ?? null);
  const keys = x.exec.values.flatMap((v) =>
    "kind" in v.from && v.from.kind === "fact" ? [v.from.key] : [],
  );
  const event = h?.snapshot?.trigger?.event;
  const reader =
    keys.length > 0 && h?.pack_key && h.pack_record_id && typeof event === "string"
      ? factsReaderFor(h.pack_key, event)
      : undefined;
  const facts =
    reader && h?.pack_record_id
      ? ((await reader.read(x.tenantId, h.pack_record_id, [
          ...new Set(keys),
        ])) as SetSources["facts"])
      : null;
  return { inputs: x.inputs, fieldsByStep, facts };
}

/** Giá trị sai dạng ⇒ MỘT dòng audit (actor hệ thống), không ném. */
export async function auditSetBad(
  tx: Tx,
  x: { tenantId: string; runId: string; stageIdx: number; keys: readonly string[] },
): Promise<void> {
  if (x.keys.length === 0) return;
  const summary = {
    kind: "set_value_invalid",
    run_id: x.runId,
    stage_idx: x.stageIdx,
    keys: x.keys,
  };
  await tx.execute(sql`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id,
      entity_name, summary)
    select r.tenant_id, null, null, 'update', 'process_run', r.id, left(coalesce(r.snapshot->>'name', ''), 200),
      ${JSON.stringify(summary)}::jsonb
    from hub.process_runs r where r.id = ${x.runId} and r.tenant_id = ${x.tenantId}`);
}
