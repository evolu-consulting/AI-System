// CR-124 · q3 · kit đọc hộ gói trạng thái "nhận theo sự kiện" của một công ty (gói không đọc bảng hub/admin — D-06, `hub-scope`):
// (1) `armed` = cờ flow theo sự kiện của công ty BẬT và có flow đang bật gán cho công ty có `trigger_event = <event>`;
// (2) `actor` = người phụ trách đã đặt nếu còn là thành viên nội bộ, hoạt động, không bị khoá; không thì `tenant_admin` hoạt động,
// không bị khoá, sớm nhất; không có ⇒ null (KHÔNG lùi về thành viên bất kỳ). MỘT câu, scope system.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

export async function flowReceiveState(
  db: Db,
  q: { tenantId: string; ownerId: string | null; event: string },
): Promise<{ armed: boolean; actor: string | null }> {
  const { tenantId, ownerId, event } = q;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ armed: boolean; actor: string | null }>(sql`select
      (exists (select 1 from hub.tenant_flow_settings s where s.tenant_id = ${tenantId}::uuid and s.flow_triggers)
        and exists (select 1 from hub.company_flows cf
          join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
          where cf.tenant_id = ${tenantId}::uuid and cf.enabled and d.trigger_event = ${event})) as armed,
      coalesce(
        (select u.id::text from admin.users u where u.id = ${ownerId}::uuid and u.tenant_id = ${tenantId}::uuid
          and u.kind = 'internal' and u.active and not u.locked_by_tenant),
        (select u.id::text from admin.users u where u.tenant_id = ${tenantId}::uuid and u.role = 'tenant_admin'
          and u.kind = 'internal' and u.active and not u.locked_by_tenant order by u.created_at, u.id limit 1)) as actor`),
  );
  return { armed: r?.armed === true, actor: r?.actor ?? null };
}
