// CR-127 · Z5 · dữ liệu cũ cho test: "bản công ty sao từ mẫu Thư viện" (đường sao chép đã gỡ — chỉ còn bản đã tạo trước đây). Dựng thẳng
// bằng SQL (cùng hình với bản cũ: def công ty có `source_template_id`, dòng `company_flows` Tắt/chưa xuất bản).
import type { Sql } from "@ai/test-kit/db";

export async function seedCompanyCopy(
  o: Sql,
  w: {
    tenantId: string;
    srcFlowId: string;
    actor: string;
    /** `{ <group_key>: <group_id> }` — đổi `group_key` của bước duyệt sang `group_id` (như bản cũ khi sao chép). */
    bind?: Record<string, string | null>;
  },
): Promise<{ flowId: string; rowId: string }> {
  // một bản mỗi công ty × nguồn (như UNIQUE `process_defs_company_copy_idx`): đã có ⇒ trả lại bản đó
  const [had] = await o<
    { flow_id: string; row_id: string }[]
  >`select d.id::text as flow_id, cf.id::text as row_id
    from hub.process_defs d join hub.company_flows cf on cf.flow_id = d.id and cf.tenant_id = d.tenant_id
    where d.tenant_id = ${w.tenantId}::uuid and d.source_template_id = ${w.srcFlowId}::uuid and d.deleted_at is null limit 1`;
  if (had) return { flowId: had.flow_id, rowId: had.row_id };
  const [src] = await o<{ stages: unknown }[]>`select r.stages from hub.process_defs d
    join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
    where d.id = ${w.srcFlowId}::uuid and d.tenant_id is null`;
  let text = JSON.stringify(src?.stages ?? []);
  for (const [k, id] of Object.entries(w.bind ?? {}))
    text = text.replaceAll(`"group_key":"${k}"`, `"group_id":${JSON.stringify(id)}`);
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description,
      input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, ttl_days, trigger, app,
      source_template_id, source_rel_version, created_by, updated_by)
    select ${w.tenantId}::uuid, left(d.key, 26) || '-cty', r.name, d.description, d.input_hint, '{}'::uuid[], ${text}::text::jsonb,
      d.token_budget, true, coalesce(d.sources, '[]'::jsonb), coalesce(d.inputs, '[]'::jsonb), d.ttl_days, d.trigger, d.app,
      d.id, d.published_version, ${w.actor}::uuid, ${w.actor}::uuid
    from hub.process_defs d join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
    where d.id = ${w.srcFlowId}::uuid and d.tenant_id is null returning id::text as id`;
  const [cf] = await o<{ id: string }[]>`insert into hub.company_flows
      (tenant_id, flow_id, enabled, position, off_reason, updated_by)
    select ${w.tenantId}::uuid, ${d?.id as string}::uuid, false,
      coalesce((select position from hub.company_flows where tenant_id = ${w.tenantId}::uuid and flow_id = ${w.srcFlowId}::uuid), 0),
      'not_published', ${w.actor}::uuid
    returning id::text as id`;
  return { flowId: d?.id as string, rowId: cf?.id as string };
}
