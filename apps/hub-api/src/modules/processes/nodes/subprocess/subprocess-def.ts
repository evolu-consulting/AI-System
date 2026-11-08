// CR-125 · «Quy trình con» — def của lượt con theo khoá: quy trình của CÔNG TY (bật, chưa xoá) thắng; vắng ⇒ quy trình Thư viện đã xuất bản
// (bản xuất bản mới nhất, Group theo mã đổi sang id công ty — như `triggers/flow-launch.ts`). Thư viện đọc ở scope system (releases chỉ
// system đọc), kết nối riêng, chỉ đọc. Thiếu / chưa xuất bản / thiếu Group ⇒ null.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { LauncherDeps } from "../../runs/launch-common";
import { findDefByKey, libraryFlowDef, type StartDefRow } from "../../runs/runs.repo";
import { bindGroupKeys, groupKeysOf } from "../../triggers/group-keys.rules";

export async function resolveSubprocessDef(
  d: Pick<LauncherDeps, "db">,
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<StartDefRow | null> {
  const own = await findDefByKey(tx, tenantId, key);
  if (own) return own.enabled && !own.deleted ? own : null;
  const lib = await withHubScope(d.db, { kind: "system" }, async (sys) => {
    const [row] = await sys.execute<{ id: string }>(sql`select id from hub.process_defs
      where tenant_id is null and key = ${key} and deleted_at is null and published_version is not null
      order by created_at desc, id desc limit 1`);
    const def = row ? await libraryFlowDef(sys, row.id) : null;
    if (!def) return null;
    const keys = groupKeysOf(def.stages);
    const groups =
      keys.length === 0
        ? []
        : await sys.execute<{ id: string; key: string }>(sql`select id, key from admin.groups
            where tenant_id = ${tenantId}::uuid and key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`);
    return { def, ids: new Map(groups.map((g) => [g.key, g.id])) };
  });
  if (!lib) return null;
  const b = bindGroupKeys(lib.def.stages, lib.ids);
  return b.missing.length > 0 ? null : { ...lib.def, stages: b.stages };
}
