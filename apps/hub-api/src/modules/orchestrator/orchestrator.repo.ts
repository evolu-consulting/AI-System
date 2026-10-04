// HUB-FR-20 · HUB-FR-29 · H1-R05, R06 · SQL của vòng Orchestrator (plan H1 §6.1–6.2). Gọi trong `withHubScope(system)`
// (việc nền của chủ run), vẫn lọc `tenant_id` của run.
import type { HistoryItem } from "@ai/contracts/hub";
import { HISTORY_CONTENT_MAX } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { flows, messages } from "@ai/db/schema/hub";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { insertStep } from "../../lib/run-steps";

export type FlowState = { agentId: string | null; pendingAsk: boolean };
export type RunKey = { id: string; tenantId: string; userId: string; flowId: string };

export async function flowState(tx: Tx, r: RunKey): Promise<FlowState> {
  const [row] = await tx
    .select({ agentId: flows.agentId, pendingAsk: flows.pendingAsk })
    .from(flows)
    .where(and(eq(flows.id, r.flowId), eq(flows.tenantId, r.tenantId)));
  return row ?? { agentId: null, pendingAsk: false };
}

/** `history_n` tin gần nhất của flow, trừ tin của run hiện tại; cũ → mới. */
export async function flowHistory(tx: Tx, r: RunKey, limit: number): Promise<HistoryItem[]> {
  if (limit <= 0) return [];
  const rows = await tx
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, r.tenantId),
        eq(messages.flowId, r.flowId),
        or(isNull(messages.runId), ne(messages.runId, r.id)),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return rows
    .reverse()
    .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CONTENT_MAX) }));
}

/** H1-R06 · delegate ngoài danh sách được phép: ghi trace `skipped`, không job. `seq` do DB cấp (P11). */
export async function insertSkippedStep(
  tx: Tx,
  p: { run: RunKey; agentId: string | null; agentKey: string },
): Promise<void> {
  await insertStep(tx, {
    id: crypto.randomUUID(),
    tenantId: p.run.tenantId,
    userId: p.run.userId,
    runId: p.run.id,
    type: "delegate",
    agentId: p.agentId,
    providerKey: null,
    jobId: null,
    workflowId: null,
    labelKey: "step.delegate",
    status: "skipped",
    detail: { reason: "not_allowed", agent: p.agentKey },
    finished: true,
  });
}
