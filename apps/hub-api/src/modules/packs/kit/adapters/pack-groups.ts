// M3-decouple · HD-FR-37: Group của tenant theo khoá (`admin.groups`, scope system + lọc `tenant_id` tường minh, MỘT câu, cache
// RAM 60 s — id Group không đổi theo khoá) + Group của user từ cache cấu hình (`PackAccessView.user`, 0 SQL khi nóng; user khác
// tenant ⇒ rỗng). Thay `PackRuns.groupIdsOf` của engine cho luật duyệt của gói.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackWho } from "../application/ports";
import { packActionsFor } from "../domain/pack-access.rules";
import { type PackAccessView, packAccessInput } from "./pack-guard.middleware";

const TTL_MS = 60_000;
const NONE: ReadonlySet<string> = new Set();

export function packGroups(
  db: Db,
  view: PackAccessView,
  packKey: string,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { at: number; ids: ReadonlyMap<string, string> }>();
  return {
    async idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>> {
      const ck = `${tenantId}|${[...keys].sort().join(",")}`;
      const hit = cache.get(ck);
      if (hit && now() - hit.at < TTL_MS && keys.every((k) => hit.ids.has(k))) return hit.ids;
      if (keys.length === 0) return new Map();
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string; key: string }>(sql`select id, key from admin.groups
          where tenant_id = ${tenantId}::uuid and key = any(${`{${keys.join(",")}}`}::text[])`),
      );
      const ids = new Map(rows.map((r) => [r.key, r.id]));
      cache.set(ck, { at: now(), ids });
      return ids;
    },
    /** contract-flow S2 · id Group nào CÒN ở tenant (kiểm khi lưu mẫu luồng; đường lạnh, MỘT câu, không cache). */
    async existingIds(tenantId: string, ids: readonly string[]): Promise<ReadonlySet<string>> {
      if (ids.length === 0) return new Set();
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string }>(sql`select id::text as id from admin.groups
          where tenant_id = ${tenantId}::uuid and id = any(${`{${ids.join(",")}}`}::uuid[])`),
      );
      return new Set(rows.map((r) => r.id));
    },
    /** contract-flow S3b · Group của tenant (id + tên) cho UI luồng duyệt (đường lạnh, MỘT câu, ≤ 500). */
    async list(tenantId: string): Promise<{ id: string; name: string }[]> {
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string; name: string }>(sql`select id::text as id,
            coalesce(name->>'vi', name->>'en', key) as name
          from admin.groups where tenant_id = ${tenantId}::uuid order by 2, id limit 500`),
      );
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },
    /** CR-108 · số thành viên còn dùng được (active, không bị khoá, nội bộ) mỗi Group của tenant: MỘT câu cho cả lô id. */
    async memberCounts(
      tenantId: string,
      ids: readonly string[],
    ): Promise<ReadonlyMap<string, number>> {
      if (ids.length === 0) return new Map();
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{
          group_id: string;
          n: number;
        }>(sql`select gm.group_id::text as group_id, count(*)::int as n
          from admin.group_members gm join admin.users u on u.id = gm.user_id and u.tenant_id = gm.tenant_id
          where gm.tenant_id = ${tenantId}::uuid and gm.group_id = any(${`{${ids.join(",")}}`}::uuid[])
            and u.active and not u.locked_by_tenant and u.kind = 'internal'
          group by gm.group_id`),
      );
      return new Map(rows.map((r) => [r.group_id, r.n]));
    },
    async userGroups(who: PackWho): Promise<ReadonlySet<string>> {
      await view.adminSettled?.();
      const u = await view.user(who.userId);
      return u && u.tenantId === who.tenantId ? u.groupIds : NONE;
    },
    /** Quyền gói của user (cùng luật `packGuard`, cache cấu hình — 0 SQL khi nóng). */
    async actionsOf(who: PackWho): Promise<ReadonlySet<string>> {
      return new Set(packActionsFor(await packAccessInput(view, packKey, who)));
    },
  };
}
