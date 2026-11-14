// HD-FR-52 · N1 Q8 · HD5 plan: danh bạ thành viên gói `GET /members` → `{items:[{id,name}]}` (người dùng dùng được của CÙNG tenant
// token, gồm chính mình) để hiện tên người phụ trách. Đọc `admin.users` cột `hub_ro` như `directory` (một câu, lọc tenant tường minh).
// Quyền `read` của gói. Không lộ username/email.
import {
  MEMBERS_MAX,
  MembersQuerySchema,
  type MembersResponse,
} from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { AppError } from "../../../../lib/errors";
import { parseQuery } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "./pack-guard.middleware";

export function packMembersRoutes(
  view: PackAccessView,
  packKey: string,
  db: Db,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/members", packGuard(view, packKey, "read"), async (c) => {
    const u = c.get("user");
    // CR-102a · com-c2: danh bạ người phụ trách/nhóm duyệt là của nhân viên — đối tác không gọi được, không có trong danh sách.
    if (u.userKind === "external") throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    const q = parseQuery(c, MembersQuerySchema);
    // CR-151: có `limit` ⇒ trang (tìm theo tên ở máy chủ, lấy limit+1 để biết còn trang); không ⇒ danh bạ đầy đủ (tra tên).
    const lim = q.limit;
    const take = lim === undefined ? MEMBERS_MAX : lim + 1;
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, "\\$&")}%` : null;
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: u.tenantId, userId: u.userId },
      (tx) =>
        tx.execute<{
          id: string;
          name: string;
        }>(sql`select u.id, u.display_name as name from admin.users u
          where u.tenant_id = ${u.tenantId}::uuid and u.active and not u.locked_by_tenant
            and u.kind = 'internal' and (${like}::text is null or u.display_name ilike ${like}::text)
          order by lower(u.display_name), u.id limit ${take}::int offset ${lim === undefined ? 0 : q.offset}::int`),
    );
    const body: MembersResponse = {
      items: rows.slice(0, lim ?? MEMBERS_MAX).map((x) => ({ id: x.id, name: x.name })),
      ...(lim === undefined ? {} : { next_offset: rows.length > lim ? q.offset + lim : null }),
    };
    return c.json(body);
  });
  return r;
}
