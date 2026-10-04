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

// ---------- xác nhận `side_effect` (plan-db §3.2; transaction `user` theo tenant/user của job) ----------
export type ConfirmKey = {
  tenantId: string;
  userId: string;
  flowId: string;
  runId: string;
  agentId: string;
  workflowId: string;
};

/** Bước 1: tiêu thụ nguyên tử `confirmed` do E12 quyết cho đúng run này; true = được gọi Dify một lần. */
export async function consumeConfirmation(tx: Tx, k: ConfirmKey): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`UPDATE hub.tool_confirmations
    SET status = 'consumed', consumed_at = now()
    WHERE flow_id = ${k.flowId} AND agent_id = ${k.agentId} AND workflow_id = ${k.workflowId}
      AND status = 'confirmed' AND decided_run_id = ${k.runId}
    RETURNING id`);
  return rows.length > 0;
}

/** Bước 2 (0 dòng ở bước 1): bước `tool` `failed` CONFIRMATION_REQUIRED rồi `pending` (thứ tự khoá run_steps → tool_confirmations). */
export async function requireConfirmation(tx: Tx, k: ConfirmKey): Promise<void> {
  await insertStep(tx, {
    id: crypto.randomUUID(),
    tenantId: k.tenantId,
    userId: k.userId,
    runId: k.runId,
    type: "tool",
    agentId: k.agentId,
    workflowId: k.workflowId,
    providerKey: null,
    jobId: null,
    labelKey: "step.tool",
    status: "failed",
    detail: { code: "CONFIRMATION_REQUIRED" },
    finished: true,
  });
  await tx.execute(sql`INSERT INTO hub.tool_confirmations
      (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
    VALUES (${k.tenantId}, ${k.userId}, ${k.flowId}, ${k.runId}, ${k.agentId}, ${k.workflowId}, 'pending')
    ON CONFLICT (flow_id, agent_id, workflow_id) WHERE status IN ('pending', 'confirmed')
    DO UPDATE SET run_id = EXCLUDED.run_id, created_at = now()
    WHERE hub.tool_confirmations.status = 'pending'`);
}

/** `runs.locale` của run của job (câu hỏi xác nhận theo locale, plan-errors §5). */
export async function runLocale(tx: Tx, runId: string, tenantId: string): Promise<"vi" | "en"> {
  const rows = await tx.execute<{ locale: "vi" | "en" }>(
    sql`SELECT locale FROM hub.runs WHERE id = ${runId} AND tenant_id = ${tenantId}`,
  );
  return rows[0]?.locale ?? "vi";
}
