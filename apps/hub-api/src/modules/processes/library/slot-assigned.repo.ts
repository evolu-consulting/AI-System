// CR-121 · D-4 · "công ty ĐÃ gán quy trình cho khe?" — nguồn duy nhất là luật định tuyến (`hub.process_routing_rules`). Gán = có ≥ 1 luật
// `source = 'admin'` (người gán/sửa: đường admin gán, PUT luật, seed) của tenant × khe. Luật `source = 'auto'` do `ensureSlotDefaults` tự cấp
// là CHƯA gán — dấu tường minh (hub 0096), KHÔNG so với `process_slots.default_def_id` lúc hỏi (đổi mẫu khe của platform không đổi nghĩa
// luật đã cấp; admin chủ động gán đúng mẫu khe vẫn tính là gán). Dùng làm cổng mở lượt duyệt engine (thay feature `contracts-approval-engine`).
// MỘT câu SQL cố định theo index (tenant, slot), scope system (Luật 4c); tenant/khe sai định dạng ⇒ false, không chạm DB.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

/** Câu tra (xuất cho test). */
export const SLOT_ASSIGNED_SQL = (tenantId: string, slot: string) => sql`
  select exists (
    select 1 from hub.process_routing_rules r
    where r.tenant_id = ${tenantId}::uuid and r.slot = ${slot} and r.source = 'admin') as assigned`;

export async function slotAssigned(db: Db, tenantId: string, slot: string): Promise<boolean> {
  if (!UUID.test(tenantId) || !SLOT.test(slot)) return false;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ assigned: boolean }>(SLOT_ASSIGNED_SQL(tenantId, slot)),
  );
  return r?.assigned === true;
}
