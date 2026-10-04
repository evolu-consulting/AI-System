// HUB-FR-95 · HUB-BR-20 · H2a-R22 · E12 quyết định xác nhận `side_effect` của flow (plan-db §3.1). Trong `createRunTx`
// (transaction `user`, sau INSERT messages, chỉ khi flow đã có): `pending` → `confirmed` (tin đồng ý) | `declined`;
// `confirmed` chưa dùng của run trước → `expired`. Trace: bước `tool` `skipped` của run mới, `detail.confirmation`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { insertStep } from "../../lib/run-steps";
import type { Owner } from "./runs.repo";

type Decided = { agent_id: string; workflow_id: string; status: "confirmed" | "declined" };

export async function decideConfirmations(
  tx: Tx,
  o: Owner,
  p: { flowId: string; runId: string; agree: boolean },
): Promise<void> {
  const rows = await tx.execute<
    Decided & { from_pending: boolean }
  >(sql`UPDATE hub.tool_confirmations
    SET status = CASE WHEN status = 'pending' AND ${p.agree} THEN 'confirmed'
                      WHEN status = 'pending' THEN 'declined' ELSE 'expired' END,
        decided_run_id = CASE WHEN status = 'pending' THEN ${p.runId}::uuid ELSE decided_run_id END,
        decided_at = coalesce(decided_at, now())
    WHERE flow_id = ${p.flowId} AND status IN ('pending', 'confirmed')
    RETURNING agent_id, workflow_id, status, decided_run_id = ${p.runId}::uuid AS from_pending`);
  for (const r of rows) {
    if (!r.from_pending) continue;
    await insertStep(tx, {
      id: crypto.randomUUID(),
      tenantId: o.tenantId,
      userId: o.userId,
      runId: p.runId,
      type: "tool",
      agentId: r.agent_id,
      workflowId: r.workflow_id,
      providerKey: null,
      jobId: null,
      labelKey: "step.tool",
      status: "skipped",
      detail: { confirmation: r.status },
      finished: true,
    });
  }
}
