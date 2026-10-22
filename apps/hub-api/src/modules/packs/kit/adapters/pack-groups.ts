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
