// CR-105 · L1 · design §3.1 · Luật 4c: tra quy trình của khe cho tenant lúc mở lượt — MỘT câu SQL cố định, scope system, tenant
// từ ngữ cảnh gói (không từ client): gán (PK tenant, slot) ⇒ không có ⇒ mặc định khe (PK slot) ⇒ bản xuất bản hiện hành (PK
// def_id, rel_version). Mọi lookup theo PK ⇒ p95 không phụ thuộc số tenant/release (perf: `slot-resolve.perf.int.test.ts`).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import type { ResolvedSlot } from "../../packs/kit/application/slot.ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

type Row = { def_id: string; name: string; rel_version: number; slot_body: unknown };

/** Câu tra (xuất để perf test đo đúng câu chạy thật). Def đã xoá mềm / chưa xuất bản / khác khe ⇒ không hàng. */
export const RESOLVE_SLOT_SQL = (tenantId: string, slot: string) => sql`
  select d.id as def_id, r.name, r.rel_version, r.slot_body
  from (select coalesce(
          (select a.def_id from hub.process_slot_assignments a where a.tenant_id = ${tenantId}::uuid and a.slot = ${slot}),
          (select s.default_def_id from hub.process_slots s where s.slot = ${slot})) as def_id) x
  join hub.process_defs d on d.id = x.def_id and d.deleted_at is null and d.slot = ${slot}
  join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version`;

/** Quy trình đang chạy của khe cho tenant; chưa có bản xuất bản nào áp được ⇒ null (gói rơi về đường cũ). */
export async function resolveSlot(
  db: Db,
  tenantId: string,
  slot: string,
): Promise<ResolvedSlot | null> {
  if (!UUID.test(tenantId) || !SLOT.test(slot)) return null;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<Row>(RESOLVE_SLOT_SQL(tenantId, slot)),
  );
  return r
    ? { defId: r.def_id, name: r.name, relVersion: Number(r.rel_version), slotBody: r.slot_body }
    : null;
}
