// CR-160 · đọc dữ kiện LÕI của lượt (`domain/if/core-facts.rules`) — MỘT câu văn bản hằng, chạy TRONG tx đã khoá run (cùng cách nối bảng và
// lọc `tenant_id` của run như `core/starter-head.sql.ts`). Không migration, không ghi gì. Đọc HIỆN TẠI mỗi lần node Nếu rẽ (flow-model §C).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { FlowFactsRead } from "../../application/ports";

/** `starter_is_top`: người bắt đầu lượt là `head_user_id` của phòng không có `parent_group_id` (cùng tenant với run). Không thấy run ⇒ 0 hàng. */
export const CORE_FACTS_SQL = (tenantId: string, runId: string) => sql`
  select exists (
    select 1 from admin.departments d
    where d.tenant_id = pr.tenant_id and d.parent_group_id is null
      and d.head_user_id is not null and d.head_user_id = pr.started_by) as starter_is_top
  from hub.process_runs pr
  where pr.id = ${runId}::uuid and pr.tenant_id = ${tenantId}::uuid`;

export async function readCoreFacts(
  tx: Tx,
  tenantId: string,
  runId: string,
  keys: readonly string[],
): Promise<FlowFactsRead | null> {
  if (keys.length === 0) return null;
  const [r] = await tx.execute<{ starter_is_top: boolean }>(CORE_FACTS_SQL(tenantId, runId));
  return r ? { starter_is_top: r.starter_is_top === true } : null;
}
