// CR-125 · cr125-manual-start-engine · SQL của "bắt đầu bằng phiếu": flow công ty có stage đầu `core.start-form` (bản công ty hoặc bản
// xuất bản của mẫu Thư viện được gán), id nhóm theo mã, sự kiện chống gửi trùng. Tenant LUÔN lấy từ JWT (tham số), không từ request.

import { START_FORM_EVENT, START_FORM_NODE_KEY } from "@ai/contracts/modules";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type StartFlowRow = {
  company_flow_id: string;
  flow_id: string;
  position: number;
  enabled: boolean;
  key: string;
  name: string;
  def_tenant_id: string | null;
  first_stage: unknown;
  nodes: string[] | null;
};

/**
 * Flow công ty bắt đầu bằng phiếu (stage đầu `node = core.start-form`); `key` vắng ⇒ tất cả. MỘT câu. Gọi ở scope system (đọc được bản
 * xuất bản của mẫu Thư viện, như `candidatesOf`) — lọc `cf.tenant_id` = công ty của người gọi.
 */
export async function startFlows(
  tx: Tx,
  tenantId: string,
  key: string | null,
): Promise<StartFlowRow[]> {
  return tx.execute<StartFlowRow>(sql`select cf.id as company_flow_id, cf.flow_id, cf.position, cf.enabled,
      d.key, coalesce(r.name, d.name) as name, d.tenant_id as def_tenant_id, st.stages -> 0 as first_stage,
      (select jsonb_agg(distinct s ->> 'node') from jsonb_array_elements(st.stages) s where s ? 'node') as nodes
    from hub.company_flows cf
    join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null
      and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
    left join hub.process_def_releases r on d.tenant_id is null and r.def_id = d.id
      and r.rel_version = d.published_version
    cross join lateral (select case when d.tenant_id is null then r.stages else d.stages end as stages) st
    where cf.tenant_id = ${tenantId}::uuid and st.stages -> 0 ->> 'node' = ${START_FORM_NODE_KEY}
      and (${key}::text is null or d.key = ${key}::text)
    order by cf.position, cf.id`);
}

/** id nhóm của công ty theo mã (mẫu Thư viện trỏ nhóm theo mã). MỘT câu. */
export async function groupIdsByKey(
  tx: Tx,
  tenantId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; key: string }>(sql`select id, key from admin.groups
    where tenant_id = ${tenantId}::uuid and key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`);
  return new Map(rows.map((r) => [r.key, r.id]));
}

/**
 * Ghi (hoặc lấy lại) sự kiện của MỘT lần bắt đầu: `event_id` = băm (người gọi × flow công ty × request_id) — duy nhất theo công ty ⇒
 * chỉ CÙNG người, CÙNG flow, CÙNG mã mới trùng. Ghi ở trạng thái đã chốt (`processed_at`) ⇒ bộ điều phối không nhận. Trả id + người +
 * ref của sự kiện (nơi gọi kiểm lại trước khi trả lượt cũ) và lượt đã mở của ĐÚNG flow. Scope user (RLS tenant).
 */
export async function upsertStartEvent(
  tx: Tx,
  e: {
    tenantId: string;
    eventId: string;
    ref: string;
    facts: unknown;
    actorId: string;
    companyFlowId: string;
  },
): Promise<{ id: string; actor_id: string | null; ref: string; run_id: string | null }> {
  const rows = await tx.execute<{
    id: string;
    actor_id: string | null;
    ref: string;
    run_id: string | null;
  }>(sql`with ins as (
      insert into hub.flow_events (tenant_id, event_id, event, ref, facts, actor_id, processed_at, outcome)
      values (${e.tenantId}::uuid, ${e.eventId}, ${START_FORM_EVENT}, ${e.ref}, ${JSON.stringify(e.facts)}::jsonb,
        ${e.actorId}::uuid, now(), '{"manual":true}'::jsonb)
      on conflict (tenant_id, event_id) do nothing returning id, actor_id, ref),
    ev as (select id, actor_id, ref from ins union all
      select id, actor_id, ref from hub.flow_events where tenant_id = ${e.tenantId}::uuid and event_id = ${e.eventId})
    select ev.id, ev.actor_id::text as actor_id, ev.ref, (select r.id from hub.process_runs r where r.flow_event_id = ev.id
      and r.company_flow_id = ${e.companyFlowId}::uuid limit 1) as run_id
    from ev limit 1`);
  const r = rows[0];
  if (!r) throw new Error("start_event_missing");
  return r;
}

/** Lượt đã mở của sự kiện × flow công ty (sau `duplicate`). */
export async function runOfEvent(
  tx: Tx,
  eventRowId: string,
  companyFlowId: string,
): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(
    sql`select id from hub.process_runs where flow_event_id = ${eventRowId}::uuid
      and company_flow_id = ${companyFlowId}::uuid limit 1`,
  );
  return r?.id ?? null;
}
