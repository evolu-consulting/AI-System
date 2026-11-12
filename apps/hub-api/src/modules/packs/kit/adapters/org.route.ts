// CR-139 · Q13 · `GET /org` — sơ đồ tổ chức CHỈ XEM cho người dùng thường của gói: phòng ban (cha–con) + trưởng phòng + thành viên.
// Quyền `read` của gói; user ngoài (đối tác) ⇒ 403. MỘT câu SQL cố định, lọc `tenant_id` tường minh, không N+1.
import { type ContractsOrg, ORG_DEPARTMENTS_MAX } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { AppError } from "../../../../lib/errors";
import { type PackAccessView, type PackGuardVars, packGuard } from "./pack-guard.middleware";

type Person = { id: string; name: string };
type Row = {
  id: string;
  name: string;
  parent_id: string | null;
  head: Person | null;
  members: Person[];
};

export const ORG_SQL = (tenantId: string) => sql`
  select d.group_id::text as id, coalesce(nullif(g.name->>'vi', ''), g.key) as name, d.parent_group_id::text as parent_id,
    (select jsonb_build_object('id', h.id, 'name', coalesce(nullif(h.display_name, ''), h.username)) from admin.users h
      where h.id = d.head_user_id and h.tenant_id = d.tenant_id and h.active and not h.locked_by_tenant) as head,
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(nullif(u.display_name, ''), u.username))
        order by lower(coalesce(nullif(u.display_name, ''), u.username)), u.id)
      from admin.group_members m join admin.users u on u.id = m.user_id and u.tenant_id = m.tenant_id
      where m.tenant_id = d.tenant_id and m.group_id = d.group_id and u.active and not u.locked_by_tenant and u.kind = 'internal'), '[]'::jsonb) as members
  from admin.departments d join admin.groups g on g.id = d.group_id and g.tenant_id = d.tenant_id
  where d.tenant_id = ${tenantId}::uuid
  order by lower(coalesce(nullif(g.name->>'vi', ''), g.key)), d.group_id limit ${ORG_DEPARTMENTS_MAX}::int`;

export function packOrgRoutes(view: PackAccessView, packKey: string, db: Db): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/org", packGuard(view, packKey, "read"), async (c) => {
    const u = c.get("user");
    if (u.userKind === "external") throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) => tx.execute<Row>(ORG_SQL(u.tenantId)),
    );
    const body: ContractsOrg = { departments: [...rows] };
    return c.json(body);
  });
  return r;
}
