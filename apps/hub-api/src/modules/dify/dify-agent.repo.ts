// HUB-FR-23 · H2a-R14 · SQL của `DifyAgentRunner` (plan H2a §5.4, plan-db §2 "Phiên `dify-agent`"). Gọi trong
// `withHubScope(system)` (việc nền của chủ run). Bước `delegate` không có hàng `jobs` (`job_id` NULL); `seq` do DB cấp (P11).
import type { Tx } from "@ai/db";
import { runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";
import { insertStep } from "../../lib/run-steps";

const NOW_MS = sql`date_trunc('milliseconds', now())`;
/** `cli_sessions.provider_key` / `run_steps.provider_key` của agent `dify-*`. */
export const DIFY_PROVIDER_KEY = "dify";

export type AgentStepOpen = {
  id: string;
  runId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  /** = `HUB_INSTANCE_ID`: chỉ chủ còn giữ run mới mở bước (H1-R14, như `enqueueJob`). */
  owner: string;
};

/**
 * `runs FOR SHARE` (còn `running` và còn của `owner`) → bước `delegate` `running`. Run đã đóng → null, không ghi.
 * Trả `seq` (SSE `step_id = s<seq>`).
 */
export async function openAgentStep(tx: Tx, s: AgentStepOpen): Promise<number | null> {
  const live = await tx.execute(sql`select 1 from hub.runs
    where id = ${s.runId} and status = 'running' and owner = ${s.owner} for share`);
  if (live.length === 0) return null;
  return insertStep(tx, {
    id: s.id,
    tenantId: s.tenantId,
    userId: s.userId,
    runId: s.runId,
    type: "delegate",
    agentId: s.agentId,
    providerKey: DIFY_PROVIDER_KEY,
    jobId: null,
    workflowId: null,
    labelKey: "step.delegate",
    status: "running",
    detail: null,
  });
}

/** Kết thúc bước (chỉ khi còn `running`); `detail` = trace (mã, lý do, thân upstream đã che, usage). */
export async function closeAgentStep(
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

export type DifySessionKey = { conversationId: string; agentId: string; tenantId: string };

/** plan-db §2: `conversation_id` Dify của (hội thoại, agent) — lọc `tenant_id` (BR-06). */
export async function readDifySession(tx: Tx, k: DifySessionKey): Promise<string | null> {
  const rows = await tx.execute<{ session_id: string }>(sql`select session_id from hub.cli_sessions
    where conversation_id = ${k.conversationId} and agent_id = ${k.agentId}
      and provider_key = ${DIFY_PROVIDER_KEY} and tenant_id = ${k.tenantId}`);
  return rows[0]?.session_id ?? null;
}

/** UPSERT như H1 plan-db §5.4 (`provider_key='dify'`); dòng của tenant khác không bị ghi đè. */
export async function saveDifySession(
  tx: Tx,
  k: DifySessionKey & { sessionId: string },
): Promise<void> {
  await tx.execute(sql`insert into hub.cli_sessions
      (conversation_id, agent_id, provider_key, tenant_id, session_id, updated_at)
    values (${k.conversationId}, ${k.agentId}, ${DIFY_PROVIDER_KEY}, ${k.tenantId}, ${k.sessionId}, now())
    on conflict (conversation_id, agent_id, provider_key) do update
      set session_id = excluded.session_id, updated_at = now()
      where hub.cli_sessions.tenant_id = excluded.tenant_id`);
}
