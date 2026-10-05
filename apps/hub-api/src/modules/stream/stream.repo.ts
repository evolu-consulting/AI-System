// WRK-FR-03 · P13 · SQL trace stream: gộp khoá vào `run_steps.detail` của step đã stream (sau khi step kết thúc). Gọi trong
// `withHubScope(system)` (việc nền của chủ run).
import type { Tx } from "@ai/db";
import { runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";

export async function mergeStepDetail(
  tx: Tx,
  p: { stepId: string; runId: string; patch: Record<string, unknown> },
): Promise<void> {
  await tx
    .update(runSteps)
    .set({
      detail: sql`coalesce(${runSteps.detail}, '{}'::jsonb) || ${JSON.stringify(p.patch)}::jsonb`,
    })
    .where(and(eq(runSteps.id, p.stepId), eq(runSteps.runId, p.runId)));
}
