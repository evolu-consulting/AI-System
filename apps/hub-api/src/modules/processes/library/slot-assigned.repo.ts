// CR-121 · D-4 · "công ty ĐÃ gán quy trình cho khe?" — nguồn duy nhất là luật định tuyến (`hub.process_routing_rules`; gán ở Admin
// ghi luật `is_default`, luật điều kiện ghi thêm; tập gán `process_tenant_defs` chỉ là danh sách ứng viên của luật). Gán = có ít nhất
// MỘT luật của tenant × khe KHÔNG phải "mặc định khe" (luật mặc định trỏ đúng mẫu `process_slots.default_def_id` do
// `ensureSlotDefaults` cấp là chưa gán). Dùng làm cổng mở lượt duyệt engine (thay feature `contracts-approval-engine`).
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
    where r.tenant_id = ${tenantId}::uuid and r.slot = ${slot}
      and not (r.is_default and r.def_id is not distinct from
        (select s.default_def_id from hub.process_slots s where s.slot = ${slot}))) as assigned`;

export async function slotAssigned(db: Db, tenantId: string, slot: string): Promise<boolean> {
  if (!UUID.test(tenantId) || !SLOT.test(slot)) return false;
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ assigned: boolean }>(SLOT_ASSIGNED_SQL(tenantId, slot)),
  );
  return r?.assigned === true;
}
