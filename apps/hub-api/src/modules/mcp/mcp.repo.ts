// HUB-FR-50, WRK-FR-13 · H2a-R18, R20 · P4, P11 · SQL của `/mcp` (plan-db §2). Gọi trong `withHubScope(system)`:
// `hub.jobs` không RLS; bước `tool` ghi vào run của job (mọi câu lọc `run_id` + `tenant_id` của job).
import type { Tx } from "@ai/db";
import { runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";
import { insertStep } from "../../lib/run-steps";

export type TokenJob = {
  id: string;
  tenantId: string;
  userId: string;
  runId: string;
  stepId: string;
  agentId: string | null;
  type: string;
  payload: unknown;
};

/** plan-db §2 "Token → job" (nguyên văn); index `jobs_token_hash_uq`. Người gọi kiểm `type`. */
export async function jobByTokenHash(tx: Tx, hash: Buffer): Promise<TokenJob | undefined> {
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    user_id: string;
    run_id: string;
    step_id: string;
    agent_id: string | null;
    type: string;
    payload: unknown;
  }>(sql`SELECT id, tenant_id, user_id, run_id, step_id, agent_id, type, payload FROM hub.jobs
    WHERE token_hash = ${hash} AND status = 'running'`);
  const r = rows[0];
  if (!r) return undefined;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    runId: r.run_id,
    stepId: r.step_id,
    agentId: r.agent_id,
    type: r.type,
    payload: r.payload,
  };
}

export type ToolStepStart = {
  id: string;
  tenantId: string;
  userId: string;
  runId: string;
  agentId: string;
  workflowId: string;
  /** `{inputs: maskInputs(...)}` — đã che secret rồi cắt (R20). */
  detail: Record<string, unknown>;
};

/** Bước `tool` `running` (P11: `seq` do DB cấp; P12: không phát SSE). */
export function insertToolStep(tx: Tx, s: ToolStepStart): Promise<number> {
  return insertStep(tx, {
    ...s,
    type: "tool",
    providerKey: null,
    jobId: null,
    labelKey: "step.tool",
    status: "running",
  });
}

export async function finishToolStep(
  tx: Tx,
  p: {
    id: string;
    runId: string;
    tenantId: string;
    status: "ok" | "failed";
    detail: Record<string, unknown>;
  },
): Promise<void> {
  await tx
    .update(runSteps)
    .set({
      status: p.status,
      detail: p.detail,
      finishedAt: sql`date_trunc('milliseconds', now())`,
    })
    .where(
      and(
        eq(runSteps.id, p.id),
        eq(runSteps.runId, p.runId),
        eq(runSteps.tenantId, p.tenantId),
        eq(runSteps.status, "running"),
      ),
    );
}
