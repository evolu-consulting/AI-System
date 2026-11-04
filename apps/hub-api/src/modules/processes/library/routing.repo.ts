// CR-118 §11.2 · SQL tập quy trình đã gán + luật chọn quy trình (hub 0087). Mỗi hàm MỘT câu cố định, lọc tenant TƯỜNG MINH
// (chạy được cả scope system lẫn scope user của tenant đích — RLS thêm một lớp). Mảng qua MỘT tham số JSON (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type AssignedRow = { def_id: string; name: string; rel_version: number | null };
/** Tập đã gán của tenant × khe + tên/bản xuất bản (cần đọc `process_defs` thư viện ⇒ chỉ gọi ở scope system). */
export const assignedOf = (tx: Tx, tenantId: string, slot: string): Promise<AssignedRow[]> =>
  tx.execute<AssignedRow>(sql`select a.def_id::text as def_id, d.name, d.published_version as rel_version
    from hub.process_tenant_defs a join hub.process_defs d on d.id = a.def_id
    where a.tenant_id = ${tenantId} and a.slot = ${slot} order by d.name, a.def_id`);

export type AssignedDefRow = {
  def_id: string;
  name: string;
  rel_version: number | null;
  stages: unknown[];
  slot_body: unknown;
};
/** Sơ đồ MỘT def trong tập gán của tenant × khe: bản xuất bản đang dùng (chưa có ⇒ nháp). Không trong tập ⇒ null. Một câu. */
export async function assignedDef(
  tx: Tx,
  tenantId: string,
  slot: string,
  defId: string,
): Promise<AssignedDefRow | null> {
  const [r] = await tx.execute<AssignedDefRow>(sql`select a.def_id::text as def_id,
      coalesce(r.name, d.name) as name, r.rel_version, coalesce(r.stages, d.stages) as stages,
      case when r.def_id is null then d.slot_body else r.slot_body end as slot_body
    from hub.process_tenant_defs a join hub.process_defs d on d.id = a.def_id
    left join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
    where a.tenant_id = ${tenantId} and a.slot = ${slot} and a.def_id = ${defId}`);
  return r ?? null;
}

/** Chỉ id (không đọc `process_defs`) — dùng được ở scope user của tenant. */
export async function assignedIds(tx: Tx, tenantId: string, slot: string): Promise<Set<string>> {
  const rows = await tx.execute<{
    id: string;
  }>(sql`select def_id::text as id from hub.process_tenant_defs
    where tenant_id = ${tenantId} and slot = ${slot}`);
  return new Set(rows.map((r) => r.id));
}

/** Gán vào tập; đã có ⇒ false (không đổi gì). */
export async function insertAssigned(
  tx: Tx,
  w: { tenantId: string; slot: string; defId: string; actorId: string },
): Promise<boolean> {
  const r =
    await tx.execute(sql`insert into hub.process_tenant_defs (tenant_id, def_id, slot, assigned_by)
    values (${w.tenantId}, ${w.defId}, ${w.slot}, ${w.actorId}) on conflict (tenant_id, def_id) do nothing`);
  return r.count === 1;
}

export type RuleRef = { id: string; priority: number };
/** Luật đang dùng def (chặn bỏ gán). */
export const rulesUsing = (
  tx: Tx,
  tenantId: string,
  slot: string,
  defId: string,
): Promise<RuleRef[]> =>
  tx.execute<RuleRef>(sql`select id::text as id, priority from hub.process_routing_rules
    where tenant_id = ${tenantId} and slot = ${slot} and def_id = ${defId} order by priority`);

export async function deleteAssigned(
  tx: Tx,
  tenantId: string,
  slot: string,
  defId: string,
): Promise<boolean> {
  const r = await tx.execute(sql`delete from hub.process_tenant_defs
    where tenant_id = ${tenantId} and slot = ${slot} and def_id = ${defId}`);
  return r.count === 1;
}

export type RuleRow = {
  id: string;
  priority: number;
  condition: { departmentIds?: string[] };
  def_id: string;
  is_default: boolean;
};
export type RoutingRows = { version: number; rules: RuleRow[] };

/** Version (0 = chưa có đầu danh sách) + luật theo priority. `lock` ⇒ FOR UPDATE đầu danh sách. */
export async function readRouting(
  tx: Tx,
  tenantId: string,
  slot: string,
  lock = false,
): Promise<RoutingRows> {
  const [r] = await tx.execute<{ version: number | null; rules: RuleRow[] | null }>(sql`select
      (select h.version from hub.process_routings h where h.tenant_id = ${tenantId} and h.slot = ${slot}
        ${lock ? sql`for update` : sql``}) as version,
      (select jsonb_agg(jsonb_build_object('id', x.id, 'priority', x.priority, 'condition', x.condition,
        'def_id', x.def_id, 'is_default', x.is_default) order by x.priority)
        from hub.process_routing_rules x where x.tenant_id = ${tenantId} and x.slot = ${slot}) as rules`);
  return { version: Number(r?.version ?? 0), rules: r?.rules ?? [] };
}

export type RuleWrite = { condition: Record<string, unknown>; defId: string; isDefault: boolean };
/** Thay CẢ danh sách: upsert đầu (version + 1) → xoá luật cũ → chèn luật mới (priority = vị trí). Ba câu cố định. */
export async function replaceRules(
  tx: Tx,
  w: { tenantId: string; slot: string; actorId: string; rules: readonly RuleWrite[] },
): Promise<number> {
  const [h] = await tx.execute<{ version: number }>(sql`insert into hub.process_routings
      (tenant_id, slot, version, updated_by) values (${w.tenantId}, ${w.slot}, 1, ${w.actorId})
    on conflict (tenant_id, slot) do update set version = hub.process_routings.version + 1,
      updated_by = excluded.updated_by, updated_at = now() returning version`);
  await tx.execute(
    sql`delete from hub.process_routing_rules where tenant_id = ${w.tenantId} and slot = ${w.slot}`,
  );
  if (w.rules.length > 0) {
    const rows = JSON.stringify(
      w.rules.map((r, i) => ({ p: i, c: r.condition, d: r.defId, f: r.isDefault })),
    );
    await tx.execute(sql`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      select ${w.tenantId}::uuid, ${w.slot}, (e->>'p')::int, e->'c', (e->>'d')::uuid, (e->>'f')::boolean
      from jsonb_array_elements(${rows}::jsonb) e`);
  }
  return Number(h?.version ?? 1);
}

/** Phòng ban (id) KHÔNG thuộc tenant trong `ids` — rỗng ⇒ hợp lệ. */
export async function deptsOutside(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`select x as id
    from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) x
    where not exists (select 1 from admin.departments d where d.tenant_id = ${tenantId} and d.group_id = x::uuid)`);
  return rows.map((r) => r.id);
}
