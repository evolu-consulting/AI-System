// CR-120 · cr120-single-source · CHỈ cho test int: gán def `defId` làm mặc định của tenant × khe ở NGUỒN DUY NHẤT (tập gán + đầu
// luật + luật `is_default` priority 49) bằng kết nối owner — thay cho `insert into hub.process_slot_assignments` (nay là VIEW chỉ
// đọc). Có sẵn luật mặc định ⇒ đổi def. Không dùng cho code chạy thật (đường thật: `upsertAssignment` / `ensureSlotDefaults`).
import type { Sql } from "@ai/test-kit/db";

export async function setSlotDefault(
  o: Sql,
  tenantId: string,
  slot: string,
  defId: string,
): Promise<void> {
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${tenantId}, ${defId}, ${slot})
    on conflict do nothing`;
  await o`insert into hub.process_routings (tenant_id, slot) values (${tenantId}, ${slot}) on conflict do nothing`;
  await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
    values (${tenantId}, ${slot}, 49, '{}'::jsonb, ${defId}, true)
    on conflict (tenant_id, slot) where is_default do update set def_id = excluded.def_id`;
}
