// CR-122 · E1b · FLOW2-FR-05..08/20 · SQL danh sách flow của công ty (`hub.company_flows`). Mọi câu lọc `tenant_id` TƯỜNG MINH (chạy
// trong tx scope system của service — vai đã kiểm ở service). Def của dòng phải là def Thư viện (`tenant_id NULL`) hoặc của CHÍNH
// công ty (soát E1 #2: chặn trỏ def tenant khác).
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
};

const COLS = sql`cf.id, cf.flow_id, d.key as flow_key, d.name, d.app, d.tenant_id as def_tenant_id, d.trigger_event,
  (d.trigger -> 'when') is not null as has_condition, cf.enabled, cf.position, cf.replaced_by, cf.off_reason,
  s.id as src_id, s.key as src_key, s.name as src_name, d.source_rel_version as src_version,
  s.published_version as src_published, d.published_version, d.version`;
const FROM = sql`from hub.company_flows cf
  join hub.process_defs d on d.id = cf.flow_id and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
  left join hub.process_defs s on s.id = d.source_template_id and s.tenant_id is null`;

/** ≤ 200 dòng (CHECK position 0..999; danh sách công ty nhỏ), sắp `position, id`. */
export async function listCompanyFlows(tx: Tx, tid: string): Promise<CfRow[]> {
  return tx.execute<CfRow>(sql`select ${COLS} ${FROM}
    where cf.tenant_id = ${tid}::uuid and d.deleted_at is null order by cf.position, cf.id limit 200`);
}

export async function lockCompanyFlow(tx: Tx, tid: string, id: string): Promise<CfRow | null> {
  const [r] = await tx.execute<CfRow>(sql`select ${COLS} ${FROM}
    where cf.tenant_id = ${tid}::uuid and cf.id = ${id}::uuid for update of cf`);
  return r ?? null;
}

/** Def gán được cho công ty: Thư viện ĐÃ xuất bản có trigger, hoặc def của chính công ty có trigger. */
export async function assignableDef(tx: Tx, tid: string, defId: string): Promise<boolean> {
  const [r] = await tx.execute<{ ok: boolean }>(sql`select true as ok from hub.process_defs d
    where d.id = ${defId}::uuid and d.deleted_at is null and d.trigger_event is not null
      and ((d.tenant_id is null and d.published_version is not null) or d.tenant_id = ${tid}::uuid)`);
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
      and d.trigger_event = ${event} and (d.trigger -> 'when') is null`);
  return r?.n ?? 0;
}

/** Bản công ty đã sao từ def Thư viện `src` (một bản mỗi công ty × nguồn). */
export async function copyRowOf(tx: Tx, tid: string, src: string): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select cf.id from hub.company_flows cf
    join hub.process_defs d on d.id = cf.flow_id and d.tenant_id = ${tid}::uuid
    where cf.tenant_id = ${tid}::uuid and d.source_template_id = ${src}::uuid and d.deleted_at is null limit 1`);
  return r?.id ?? null;
}

/** Dòng gốc (Thư viện) mà bản công ty `copyFlowId` thay. */
export async function originalRowOf(
  tx: Tx,
  tid: string,
  copyFlowId: string,
): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select o.id from hub.process_defs c
    join hub.company_flows o on o.tenant_id = ${tid}::uuid and o.flow_id = c.source_template_id
    where c.id = ${copyFlowId}::uuid and c.tenant_id = ${tid}::uuid`);
  return r?.id ?? null;
}

/** Sao def Thư viện (bản xuất bản mới nhất, stages đã đổi Group) thành def công ty — cùng định dạng FlowDef. */
export async function insertCopyDef(
  tx: Tx,
  w: { tid: string; src: string; key: string; stages: unknown[]; actor: string },
): Promise<string> {
  const [r] = await tx.execute<{
    id: string;
  }>(sql`insert into hub.process_defs (tenant_id, key, name, description,
      input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, ttl_days, trigger, app,
      source_template_id, source_rel_version, created_by, updated_by)
    select ${w.tid}::uuid, ${w.key}, r.name, d.description, d.input_hint, '{}'::uuid[], ${JSON.stringify(w.stages)}::jsonb,
      d.token_budget, true, coalesce(d.sources, '[]'::jsonb), coalesce(d.inputs, '[]'::jsonb), d.ttl_days, d.trigger, d.app,
      d.id, d.published_version, ${w.actor}::uuid, ${w.actor}::uuid
    from hub.process_defs d join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
    where d.id = ${w.src}::uuid and d.tenant_id is null returning id`);
  return r?.id as string;
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
