// CR-122 · E1 · readiness #3 · cờ `FLOW_TRIGGERS` theo công ty (`hub.tenant_flow_settings`, mặc định TẮT = bóng: bộ điều phối chỉ
// ghi "lẽ ra chạy" vào `flow_events.outcome`, không mở lượt; đường khe cũ vẫn mở lượt). A1/A2/M1 đọc cùng hàm.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

/** Công ty nào trong tập đang BẬT — MỘT câu, lọc `= any`. */
export async function flowTriggerTenants(
  tx: Tx,
  tenantIds: readonly string[],
): Promise<Set<string>> {
  if (tenantIds.length === 0) return new Set();
  const rows = await tx.execute<{
    tenant_id: string;
  }>(sql`select tenant_id from hub.tenant_flow_settings
    where tenant_id = any(${`{${tenantIds.join(",")}}`}::uuid[]) and flow_triggers`);
  return new Set(rows.map((r) => r.tenant_id));
}

export async function flowTriggersOn(tx: Tx, tenantId: string): Promise<boolean> {
  return (await flowTriggerTenants(tx, [tenantId])).has(tenantId);
}

/**
 * CR-125 · c2 · "Lưu và áp dụng" / gán quy trình ⇒ công ty dùng quy trình mới, KHÔNG cần bật công tắc ở chỗ khác: đặt cờ BẬT (idempotent,
 * không đổi `updated_at` khi đã bật). Công ty chưa từng áp dụng/gán sau thay đổi này giữ nguyên cờ ⇒ chạy đúng như trước (prod hiện TẮT hết).
 */
export async function ensureFlowTriggersOn(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${tenantId}::uuid, true)
    on conflict (tenant_id) do update set flow_triggers = true,
      updated_at = case when hub.tenant_flow_settings.flow_triggers then hub.tenant_flow_settings.updated_at else now() end`);
}

/** Bật/tắt (scope system — RLS chỉ cho system ghi). */
export async function setFlowTriggers(tx: Tx, tenantId: string, on: boolean): Promise<void> {
  await tx.execute(sql`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${tenantId}::uuid, ${on})
    on conflict (tenant_id) do update set flow_triggers = excluded.flow_triggers, updated_at = now()`);
}
