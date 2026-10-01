// ADM-FR-15, ADM-FR-13 · đọc `hub.agent_workflows` (Hub sở hữu bảng; production trước khi có Hub: không có bảng).
// M2-R12 / plan §3.3: mỗi transaction cần dữ liệu agent hỏi `has_table_privilege(to_regclass(…))` trước, KHÔNG cache
// (Hub có thể lên sau Admin). Cờ false → câu SQL không được nhắc tới bảng hub (tránh 42P01 lúc parse).
import { agentWorkflows, type Tx } from "@ai/db";
import { type AnyColumn, asc, eq, type SQL, sql } from "drizzle-orm";
import { outer } from "../../lib/sql";

export async function hubAgentsReadable(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`select coalesce(has_table_privilege(to_regclass('hub.agent_workflows'), 'SELECT'), false) as ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** Biểu thức đếm agent của workflow (cột `workflowId` của câu ngoài); `0` khi không đọc được bảng. */
export function agentCountExpr(readable: boolean, workflowId: AnyColumn): SQL<number> {
  return readable
    ? sql<number>`(select count(*)::int from ${agentWorkflows} where ${agentWorkflows.workflowId} = ${outer(workflowId)})`
    : sql<number>`0`;
}

/** Chỉ gọi khi `hubAgentsReadable` = true trong CÙNG transaction. */
export async function agentIdsByWorkflow(
  tx: Tx,
  workflowId: string,
  limit: number,
): Promise<{ ids: string[]; count: number }> {
  const rows = await tx
    .select({
      id: agentWorkflows.agentId,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(agentWorkflows)
    .where(eq(agentWorkflows.workflowId, workflowId))
    .orderBy(asc(agentWorkflows.agentId))
    .limit(limit);
  return { ids: rows.map((r) => r.id), count: rows[0]?.total ?? 0 };
}
