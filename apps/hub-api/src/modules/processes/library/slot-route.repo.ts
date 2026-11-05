// CR-118 §11.2 · chọn quy trình của khe cho NGƯỜI KHỞI TẠO lúc launch — MỘT câu SQL cố định scope system (Luật 4c): luật của
// tenant × khe (PK/UNIQUE tenant, slot) + phòng ban người khởi tạo và mọi tổ tiên (CTE đệ quy trên `admin.departments`; chỉ chạy
// khi có luật) + bản xuất bản hiện hành của các def ứng viên + kết quả `RESOLVE_SLOT_SQL` cũ. Chọn bằng `pickProcess` (thuần).
// Không có luật ⇒ y hệt `resolveSlot` (ruleId null). `resolveSlot` (DLC + GET /approval-flow) — CR-120: cả hai chỉ đọc luật
// (nguồn duy nhất) + mẫu khe, không đọc `process_slot_assignments`.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import type { RoutedSlot, RouteSlotFacts } from "../../packs/kit/public";
import { pickProcess, type RoutingRule } from "./routing.rules";
import { RESOLVE_SLOT_SQL } from "./slot-resolve.repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

type Cand = { name: string; rel: number; body: unknown };
type Row = {
  rules: RoutingRule[] | null;
  depts: string[] | null;
  defs: Record<string, Cand> | null;
  def_id: string | null;
  name: string | null;
  rel_version: number | null;
  slot_body: unknown;
  is_default: boolean | null;
};

/** Câu tra (xuất cho test đếm/perf). `userId` null ⇒ không gom phòng ban (chỉ luật mặc định áp được). */
export const ROUTE_SLOT_SQL = (tenantId: string, slot: string, userId: string | null) => sql`
  with recursive rr as (
    select r.id, r.priority, r.condition, r.def_id, r.is_default from hub.process_routing_rules r
    where r.tenant_id = ${tenantId}::uuid and r.slot = ${slot}),
  anc(id) as (
    select m.group_id from admin.group_members m
      join admin.departments dp on dp.group_id = m.group_id and dp.tenant_id = m.tenant_id
    where m.tenant_id = ${tenantId}::uuid and m.user_id = ${userId}::uuid and exists (select 1 from rr)
    union
    select dp.parent_group_id from anc join admin.departments dp on dp.group_id = anc.id
    where dp.tenant_id = ${tenantId}::uuid and dp.parent_group_id is not null)
  select
    (select jsonb_agg(jsonb_build_object('id', id, 'priority', priority, 'condition', condition, 'defId', def_id,
       'isDefault', is_default)) from rr) as rules,
    (select array_agg(id::text) from anc) as depts,
    (select jsonb_object_agg(d.id::text, jsonb_build_object('name', rl.name, 'rel', rl.rel_version, 'body', rl.slot_body))
       from hub.process_defs d join hub.process_def_releases rl on rl.def_id = d.id and rl.rel_version = d.published_version
       where d.id in (select def_id from rr) and d.deleted_at is null and d.slot = ${slot}) as defs,
    b.def_id, b.name, b.rel_version, b.slot_body, b.is_default
  from (select 1) one left join lateral (${RESOLVE_SLOT_SQL(tenantId, slot)}) b on true`;

/** Quy trình của khe cho người khởi tạo `userId` (+ `facts` của lượt, vd loại HĐ — cr118-route-kind); tham số sai / khe không có bản áp được (không luật) ⇒ null. */
export async function routeSlot(
  db: Db,
  tenantId: string,
  slot: string,
  userId: string | null,
  facts: RouteSlotFacts = {},
): Promise<RoutedSlot | null> {
  if (!UUID.test(tenantId) || !SLOT.test(slot) || (userId !== null && !UUID.test(userId)))
    return null;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<Row>(ROUTE_SLOT_SQL(tenantId, slot, userId)),
  );
  if (!r) return null;
  const rules = r.rules ?? [];
  if (rules.length === 0) {
    if (r.def_id === null) return null;
    return {
      defId: r.def_id,
      name: r.name ?? "",
      relVersion: Number(r.rel_version),
      slotBody: r.slot_body,
      isDefault: r.is_default === true,
      ruleId: null,
    };
  }
  const p = pickProcess(rules, r.depts ?? [], facts);
  if (p.kind === "none") return { blocked: "route_none", ruleId: null };
  const c = r.defs?.[p.rule.defId];
  if (!c) return { blocked: "route_unavailable", ruleId: p.rule.id };
  return {
    defId: p.rule.defId,
    name: c.name,
    relVersion: Number(c.rel),
    slotBody: c.body,
    // CR-120 · luật mặc định trỏ đúng mẫu khe ⇒ vẫn là "mặc định" (cùng cờ `RESOLVE_SLOT_SQL`).
    isDefault: p.rule.isDefault && r.def_id === p.rule.defId && r.is_default === true,
    ruleId: p.rule.id,
  };
}
