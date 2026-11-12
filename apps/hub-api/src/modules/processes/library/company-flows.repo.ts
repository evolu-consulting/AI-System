// CR-122 · E1b · FLOW2-FR-05..08/20 · SQL danh sách flow của công ty (`hub.company_flows`). Mọi câu lọc `tenant_id` TƯỜNG MINH (chạy
// trong tx scope system của service — vai đã kiểm ở service). Def của dòng phải là def Thư viện (`tenant_id NULL`) hoặc của CHÍNH
// công ty (soát E1 #2: chặn trỏ def tenant khác).
import { START_FORM_NODE_KEY } from "@ai/contracts/modules";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type CfRow = {
  id: string;
  flow_id: string;
  flow_key: string;
  name: string;
  app: string | null;
  def_tenant_id: string | null;
  trigger_event: string | null;
  has_condition: boolean;
  enabled: boolean;
  position: number;
  replaced_by: string | null;
  off_reason: "replaced" | "reverted" | "turned_off" | "not_published" | null;
  src_id: string | null;
  src_key: string | null;
  src_name: string | null;
  src_version: number | null;
  src_published: number | null;
  published_version: number | null;
  version: number;
  updated_at: Date | string | null;
  /** CR-127 · Z7 · còn nháp và chưa có lượt chạy ⇒ xoá được. */
  deletable: boolean;
  /** CR-122 · P15 · def công ty có bước duyệt chưa chọn nhóm (vd mã Thư viện chưa có nhóm ở công ty). */
  no_group: boolean;
  /** Flow bắt đầu bằng phiếu (stage đầu `core.start-form`) — không phải ứng viên của sự kiện ⇒ không gây/nhận cảnh báo shadow. */
  is_start_form: boolean;
};

const COLS = sql`coalesce(d.stages -> 0 ->> 'node', '') = ${START_FORM_NODE_KEY}::text as is_start_form, cf.id, cf.flow_id, d.key as flow_key, d.name, d.app, d.tenant_id as def_tenant_id, d.trigger_event,
  (d.trigger -> 'when') is not null as has_condition, cf.enabled, cf.position, cf.replaced_by, cf.off_reason,
  s.id as src_id, s.key as src_key, s.name as src_name, d.source_rel_version as src_version,
  s.published_version as src_published, d.published_version, d.version, d.updated_at,
  (d.published_version is null and not exists (select 1 from hub.process_runs pr where pr.process_def_id = d.id)) as deletable,
  (d.tenant_id is not null and exists (select 1 from jsonb_array_elements(d.stages) st
    where st -> 'after' ->> 'kind' = 'review' and case
      -- CR-127 Z9 · cùng luật reviewHasGroup (def-group-keys.rules): «cùng duyệt» ⇒ mỗi nhóm trong parallel.groups có id/mã (group_id của bước để null);
      -- bước chỉ có người duyệt (approver_user_id) hợp lệ; còn lại cần group_id.
      when jsonb_typeof(st -> 'after' -> 'parallel' -> 'groups') = 'array'
        and jsonb_array_length(st -> 'after' -> 'parallel' -> 'groups') > 0
        then exists (select 1 from jsonb_array_elements(st -> 'after' -> 'parallel' -> 'groups') g
          where coalesce(g ->> 'group_id', '') = '' and coalesce(g ->> 'group_key', '') = '')
      -- CR-139 · «Trưởng phòng của người đề xuất» (approver_mode = 'starter_head') không cần phòng.
      when st -> 'after' ->> 'approver_mode' = 'starter_head' then false
      else coalesce(st -> 'after' ->> 'group_id', '') = '' and coalesce(st -> 'after' ->> 'approver_user_id', '') = ''
    end)) as no_group`;
const FROM = sql`from hub.company_flows cf
  join hub.process_defs d on d.id = cf.flow_id and d.tenant_id = cf.tenant_id
  left join hub.process_defs s on s.id = d.source_template_id and s.tenant_id is null`;

/** ≤ 200 dòng (CHECK position 0..999; danh sách công ty nhỏ), sắp `position, id`. */
export async function listCompanyFlows(tx: Tx, tid: string): Promise<CfRow[]> {
  return tx.execute<CfRow>(sql`select ${COLS} ${FROM}
    where cf.tenant_id = ${tid}::uuid and d.deleted_at is null order by cf.position, cf.id limit 200`);
}

export async function lockCompanyFlow(
  tx: Tx,
  tid: string,
  id: string,
  lock = true,
): Promise<CfRow | null> {
  const [r] = await tx.execute<CfRow>(sql`select ${COLS} ${FROM}
    where cf.tenant_id = ${tid}::uuid and cf.id = ${id}::uuid ${lock ? sql`for update of cf` : sql``}`);
  return r ?? null;
}

/** Id dòng `company_flows` của (công ty, def) — chưa khoá; null khi def chưa có dòng. */
export async function rowIdOfFlow(tx: Tx, tid: string, flowId: string): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select id from hub.company_flows
    where tenant_id = ${tid}::uuid and flow_id = ${flowId}::uuid`);
  return r?.id ?? null;
}

/** Def áp dụng được cho công ty: def CỦA CHÍNH công ty (CR-127 Z7: không còn gán def dùng chung) và đã có Bắt đầu khi. */
export async function assignableDef(tx: Tx, tid: string, defId: string): Promise<boolean> {
  const [r] = await tx.execute<{ ok: boolean }>(sql`select true as ok from hub.process_defs d
    where d.id = ${defId}::uuid and d.deleted_at is null and d.trigger_event is not null and d.tenant_id = ${tid}::uuid`);
  return r?.ok === true;
}

export async function insertCompanyFlow(
  tx: Tx,
  w: {
    tid: string;
    flowId: string;
    enabled: boolean;
    offReason: string | null;
    position?: number;
    actor: string;
  },
): Promise<string> {
  const pos =
    w.position === undefined
      ? sql`coalesce((select max(position) + 1 from hub.company_flows
      where tenant_id = ${w.tid}::uuid), 0)`
      : sql`${w.position}::int`;
  const [r] = await tx.execute<{ id: string }>(sql`insert into hub.company_flows
      (tenant_id, flow_id, enabled, position, off_reason, updated_by)
    values (${w.tid}::uuid, ${w.flowId}::uuid, ${w.enabled}, ${pos}, ${w.offReason}, ${w.actor}::uuid)
    on conflict (tenant_id, flow_id) do update set updated_at = now() returning id`);
  return r?.id as string;
}

export async function setFlowState(
  tx: Tx,
  w: {
    tid: string;
    id: string;
    enabled: boolean;
    offReason: string | null;
    replacedBy: string | null;
    actor: string;
  },
): Promise<void> {
  await tx.execute(sql`update hub.company_flows set enabled = ${w.enabled}, off_reason = ${w.offReason},
      replaced_by = ${w.replacedBy}::uuid, updated_by = ${w.actor}::uuid, updated_at = now()
    where tenant_id = ${w.tid}::uuid and id = ${w.id}::uuid`);
}

/** Đặt thứ tự theo mảng id (MỘT câu); trả số dòng đổi. */
export async function reorderCompanyFlows(
  tx: Tx,
  tid: string,
  ids: readonly string[],
  actor: string,
): Promise<number> {
  const r = await tx.execute<{ id: string }>(sql`update hub.company_flows cf set position = x.o - 1,
      updated_by = ${actor}::uuid, updated_at = now()
    from (select (e)::uuid as id, o from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
      with ordinality as t(e, o)) x
    where cf.tenant_id = ${tid}::uuid and cf.id = x.id returning cf.id`);
  return r.length;
}

/** Số flow đang bật KHÔNG điều kiện của sự kiện ở công ty, trừ dòng `except`. */
export async function unconditionalOn(
  tx: Tx,
  tid: string,
  event: string,
  except: string,
): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n ${FROM}
    where cf.tenant_id = ${tid}::uuid and cf.enabled and cf.id <> ${except}::uuid and d.deleted_at is null
      and d.trigger_event = ${event} and (d.trigger -> 'when') is null
      and coalesce(d.stages -> 0 ->> 'node', '') <> ${START_FORM_NODE_KEY}::text`);
  return r?.n ?? 0;
}

export async function freeKey(tx: Tx, tid: string, base: string): Promise<string> {
  const rows = await tx.execute<{ key: string }>(sql`select key from hub.process_defs
    where tenant_id = ${tid}::uuid and deleted_at is null and starts_with(key, ${base})`);
  const taken = new Set(rows.map((r) => r.key));
  for (let i = 1; ; i++) {
    const k = i === 1 ? base : `${base.slice(0, 28)}-${i}`;
    if (!taken.has(k)) return k;
  }
}

/** CR-127 · E8 · quy trình công ty TRỐNG (chưa có "Bắt đầu khi" ⇒ chưa vào danh sách; vào danh sách khi "Áp dụng"). */
export async function insertBlankDef(
  tx: Tx,
  w: {
    tid: string;
    key: string;
    name: string;
    app: string;
    stages: unknown[];
    trigger: { event: string };
    actor: string;
  },
): Promise<string> {
  const [r] = await tx.execute<{
    id: string;
  }>(sql`insert into hub.process_defs (tenant_id, key, name,
      run_group_ids, stages, enabled, app, trigger, created_by, updated_by)
    values (${w.tid}::uuid, ${w.key}, ${w.name}, '{}'::uuid[], ${JSON.stringify(w.stages)}::jsonb, true, ${w.app},
      ${JSON.stringify(w.trigger)}::jsonb,
      ${w.actor}::uuid, ${w.actor}::uuid) returning id`);
  return r?.id as string;
}

export async function tenantExists(tx: Tx, tid: string): Promise<boolean> {
  const [r] = await tx.execute<{ ok: boolean }>(
    sql`select true as ok from admin.tenants where id = ${tid}::uuid`,
  );
  return r?.ok === true;
}

/** Def của dòng `company_flows` (theo công ty). */
export async function flowIdOfRow(tx: Tx, tid: string, id: string): Promise<string | null> {
  const [r] = await tx.execute<{ flow_id: string }>(sql`select flow_id::text as flow_id
    from hub.company_flows where tenant_id = ${tid}::uuid and id = ${id}::uuid`);
  return r?.flow_id ?? null;
}
