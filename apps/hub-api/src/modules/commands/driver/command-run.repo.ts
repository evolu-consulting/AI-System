// HUB-FR-13, HUB-FR-89 · H2a-R09 · SQL step `workflow` của run lệnh (plan H2a §5.1 bước 4, §5.2). Gọi trong
// `withHubScope(system)` (việc nền của chủ run). `seq` do DB cấp (P11, `lib/run-steps`).
import type { Tx } from "@ai/db";
import { runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";
import { insertStep } from "../../../lib/run-steps";

const NOW_MS = sql`date_trunc('milliseconds', now())`;

export type WorkflowStepKey = { id: string; runId: string; tenantId: string; userId: string };

/** Step `workflow` `running` của run (một run lệnh = đúng một step). Trả `seq`. */
export function openWorkflowStep(
  tx: Tx,
  s: WorkflowStepKey & { workflowId: string; detail: Record<string, unknown> | null },
): Promise<number> {
  return insertStep(tx, {
    id: s.id,
    tenantId: s.tenantId,
    userId: s.userId,
    runId: s.runId,
    type: "workflow",
    agentId: null,
    providerKey: null,
    jobId: null,
    workflowId: s.workflowId,
    labelKey: "step.workflow",
    status: "running",
    detail: s.detail,
  });
}

/** Kết thúc step (chỉ khi còn `running`); `detail` = trace (mã, lý do, thân lỗi upstream đã che). Null = không đổi. */
export async function closeWorkflowStep(
  tx: Tx,
  p: { id: string; runId: string; status: "ok" | "failed"; detail: Record<string, unknown> },
): Promise<{ startedAt: Date; finishedAt: Date } | null> {
  const [row] = await tx
    .update(runSteps)
    .set({ status: p.status, detail: p.detail, finishedAt: NOW_MS })
    .where(and(eq(runSteps.id, p.id), eq(runSteps.runId, p.runId), eq(runSteps.status, "running")))
    .returning({ startedAt: runSteps.startedAt, finishedAt: runSteps.finishedAt });
  if (!row?.finishedAt) return null;
  return { startedAt: row.startedAt, finishedAt: row.finishedAt };
}
