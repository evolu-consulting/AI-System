// ADM-FR-37 · X1 plan §2.4 · `agent_count` của group đọc `hub.agent_grants` (Hub sở hữu bảng; có thể chưa có / mất quyền).
// Mẫu `workflows.hub.ts`: hỏi `has_table_privilege(to_regclass(…))` trong CÙNG transaction, KHÔNG cache.
// Cờ false → câu SQL không nhắc tới bảng hub (tránh 42P01/42501 lúc parse/plan) → agent_count = 0.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export async function hubGrantsReadable(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`select coalesce(has_table_privilege(to_regclass('hub.agent_grants'), 'SELECT'), false) as ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** Số agent khác nhau được grant cho group `g` (alias câu ngoài), lọc tường minh tenant (index agent_grants_subject_idx). */
export function groupAgentCountExpr(readable: boolean): SQL {
  return readable
    ? sql`(select count(distinct ag.agent_id)::int from hub.agent_grants ag
        where ag.tenant_id = g.tenant_id and ag.subject_type = 'group' and ag.subject_id = g.id)`
    : sql`0`;
}
