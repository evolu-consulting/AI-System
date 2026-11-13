// CR-145 · danh bạ NGƯỜI của tenant cho gợi ý/kiểm "nhắc tên" trong bài: tên + công ty, MỘT câu theo tập id (`= any(array)`), chỉ user
// còn dùng được (nội bộ: active, không bị khoá; đối tác: chưa vô hiệu). `community_rw` không đọc `admin.users` ⇒ qua hub scope hệ thống
// (cùng khuôn `packHosts`/`ExternalOrgResolver`); tenant khoá tường minh nên không lộ user tenant khác.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

export type Person = { id: string; name: string; org: string | null };
export type PeopleReader = (
  tenantId: string,
  ids: readonly string[],
  o?: { q?: string | undefined; limit?: number | undefined },
) => Promise<Person[]>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function peopleReader(db: Db): PeopleReader {
  return async (tenantId, ids, o = {}) => {
    const clean = [...new Set(ids)].filter((i) => UUID_RE.test(i));
    if (clean.length === 0 || !UUID_RE.test(tenantId)) return [];
    const q = (o.q ?? "").trim().replace(/[\\%_]/g, "\\$&");
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ id: string; name: string; org: string | null }>(sql`
        select u.id::text as id, u.display_name as name, u.external_org_id::text as org
        from admin.users u
        where u.tenant_id = ${tenantId}::uuid
          and u.id = any(array(select jsonb_array_elements_text(${JSON.stringify(clean)}::jsonb))::uuid[])
          and ((u.kind = 'internal' and u.active and not u.locked_by_tenant)
            or (u.kind = 'external' and u.deactivated_at is null))
          and (${q} = '' or u.display_name ilike ${`%${q}%`})
        order by u.display_name, u.id limit ${o.limit ?? 500}::int`),
    );
    return rows.map((r) => ({ id: r.id, name: r.name, org: r.org }));
  };
}
