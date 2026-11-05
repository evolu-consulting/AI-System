// CR-105 · L1 · design §3.1 · Luật 4c: tra quy trình của khe cho tenant lúc mở lượt — MỘT câu SQL cố định, scope system, tenant
// từ ngữ cảnh gói (không từ client): luật mặc định (CR-120, index tenant, slot) ⇒ không có ⇒ mẫu khe (PK slot) ⇒ bản xuất bản hiện hành (PK
// def_id, rel_version). Mọi lookup theo PK ⇒ p95 không phụ thuộc số tenant/release (perf: `slot-resolve.perf.int.test.ts`).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import type { ResolvedSlot } from "../../packs/kit/public";

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

type Row = {
  def_id: string;
  name: string;
  rel_version: number;
  slot_body: unknown;
  is_default: boolean;
};

/**
 * Câu tra (xuất để perf test đo đúng câu chạy thật). Def đã xoá mềm / chưa xuất bản / khác khe ⇒ không hàng.
 * CR-120 · ADR-0036 · một nguồn: luật `is_default` của tenant × khe (index một-mặc-định) ⇒ không có ⇒ mẫu cấp phát của khe
 * (`process_slots.default_def_id`, cho tenant chưa được `ensureSlotDefaults` cấp — giữ hành vi cũ). KHÔNG đọc `process_slot_assignments`.
 * `is_default` = def hiệu lực là mặc định của khe (không luật, hoặc luật mặc định trỏ đúng mẫu).
 */
export const RESOLVE_SLOT_SQL = (tenantId: string, slot: string) => sql`
  select d.id as def_id, r.name, r.rel_version, r.slot_body,
    (x.a_id is null or coalesce(x.a_id = x.s_id, false)) as is_default
  from (select
          (select a.def_id from hub.process_routing_rules a
            where a.tenant_id = ${tenantId}::uuid and a.slot = ${slot} and a.is_default) as a_id,
          (select s.default_def_id from hub.process_slots s where s.slot = ${slot}) as s_id) x
  join hub.process_defs d on d.id = coalesce(x.a_id, x.s_id) and d.deleted_at is null and d.slot = ${slot}
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
    ? {
        defId: r.def_id,
        name: r.name,
        relVersion: Number(r.rel_version),
        slotBody: r.slot_body,
        isDefault: r.is_default === true,
      }
    : null;
}

/** dlc-agent-flows · def thư viện `key` của khe (agent chỉ định, bỏ qua gán tenant) ở bản xuất bản hiện hành; MỘT câu theo
 *  index key, scope system. Def đã xoá / chưa xuất bản / khác khe ⇒ null. */
export async function resolveSlotDef(
  db: Db,
  slot: string,
  key: string,
): Promise<ResolvedSlot | null> {
  if (!SLOT.test(slot) || !KEY.test(key)) return null;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<Row>(sql`select d.id as def_id, r.name, r.rel_version, r.slot_body, false as is_default
      from hub.process_defs d
      join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
      where d.key = ${key} and d.slot = ${slot} and d.tenant_id is null and d.deleted_at is null`),
  );
  return r
    ? { defId: r.def_id, name: r.name, relVersion: Number(r.rel_version), slotBody: r.slot_body }
    : null;
}
