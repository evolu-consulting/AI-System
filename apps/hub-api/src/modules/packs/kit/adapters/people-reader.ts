// CR-145 · danh bạ NGƯỜI của tenant cho gợi ý/kiểm "nhắc tên" trong bài: tên + công ty, MỘT câu theo tập id (`= any(array)`), chỉ user
// còn dùng được (nội bộ: active, không bị khoá; đối tác: chưa vô hiệu). `community_rw` không đọc `admin.users` ⇒ qua hub scope hệ thống
// (cùng khuôn `packHosts`/`ExternalOrgResolver`); tenant khoá tường minh nên không lộ user tenant khác.
// CR-191 · nhắc người công ty ĐÃ KẾT NỐI: `connectedTenants` (tập tenant đã qua hàm DEFINER `community.connected_audience`, do service truyền
// vào) = mọi người NỘI BỘ còn dùng được của các tenant đó; `foreignIds` = ứng viên theo id ở tenant KHÁC (chỉ để service kiểm tiếp bằng
// `community.mention_tenants_ok` trong tx ghi bài). Hàng tenant khác kèm tên công ty; trả cả chức vụ (`hub.people_profiles`).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

export type Person = {
  id: string;
  name: string;
  org: string | null;
  /** Tenant của người này. */
  tenant?: string;
  /** Chức vụ (nếu có hồ sơ). */
  title?: string | null;
};
export type PeopleReader = (
  tenantId: string,
  ids: readonly string[],
  o?: {
    q?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    connectedTenants?: readonly string[] | undefined;
    foreignIds?: readonly string[] | undefined;
  },
) => Promise<Person[]>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (xs: readonly string[] | undefined): string[] => [
  ...new Set((xs ?? []).filter((i) => UUID_RE.test(i))),
];

export function peopleReader(db: Db): PeopleReader {
  return async (tenantId, ids, o = {}) => {
    const own = clean(ids);
    const conn = clean(o.connectedTenants).filter((t) => t !== tenantId);
    const foreign = clean(o.foreignIds);
    if ((own.length === 0 && conn.length === 0 && foreign.length === 0) || !UUID_RE.test(tenantId))
      return [];
    const q = (o.q ?? "").trim().replace(/[%_]/g, "$&");
    const arr = (x: string[]) =>
      sql`array(select jsonb_array_elements_text(${JSON.stringify(x)}::jsonb))::uuid[]`;
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{
        id: string;
        name: string;
        org: string | null;
        tenant: string;
        title: string | null;
      }>(sql`
        select u.id::text as id, u.display_name as name, u.external_org_id::text as org, u.tenant_id::text as tenant,
          pp.job_title as title
        from admin.users u
        left join hub.people_profiles pp on pp.tenant_id = u.tenant_id and pp.user_id = u.id
        where ((u.tenant_id = ${tenantId}::uuid and u.id = any(${arr(own)})
              and ((u.kind = 'internal' and u.active and not u.locked_by_tenant)
                or (u.kind = 'external' and u.deactivated_at is null)))
            or (u.tenant_id <> ${tenantId}::uuid and u.kind = 'internal' and u.active and not u.locked_by_tenant
              and (u.tenant_id = any(${arr(conn)}) or u.id = any(${arr(foreign)}))))
          and (${q} = '' or u.display_name ilike ${`%${q}%`})
        order by u.display_name, u.id limit ${o.limit ?? 500}::int offset ${o.offset ?? 0}::int`),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      org: r.org,
      tenant: r.tenant,
      title: r.title,
    }));
  };
}
