// CR-121 c9 · R9 · lọc `GET /process-runs?slot=&def_id=`. Lượt theo khe ghi def thư viện đã chọn vào `snapshot.process_def_id` lúc
// launch (`stampSlotRun`); khe ⇒ tập def (thư viện của khe ∪ bản riêng CÔNG TY NÀY sao từ chúng) tra MỘT câu scope system (def thư
// viện bị RLS ẩn ở scope user), rồi truyền vào `listRuns` như một tham số JSON ⇒ lọc cùng câu SQL liệt kê, index
// `process_runs_snap_def_idx` (tenant_id, def, started_at) — số câu cố định, không phụ thuộc số lượt.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";

/** `undefined` = không lọc; mảng rỗng = không lượt nào khớp. Tenant chỉ thấy lượt của chính mình (`listRuns` lọc `tenant_id`). */
export async function runDefIdsFor(
  db: Db,
  tenantId: string,
  q: { slot?: string | undefined; def_id?: string | undefined },
): Promise<string[] | undefined> {
  const want = q.def_id?.toLowerCase();
  if (!q.slot) return want ? [want] : undefined;
  const slot = q.slot;
  const rows = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ id: string }>(sql`select d.id::text as id from hub.process_defs d
      where (d.tenant_id is null and d.slot = ${slot})
        or (d.tenant_id = ${tenantId} and d.source_rel_version is not null and d.source_template_id in
          (select l.id from hub.process_defs l where l.tenant_id is null and l.slot = ${slot}))`),
  );
  const ids = rows.map((r) => r.id);
  return want ? ids.filter((id) => id === want) : ids;
}
