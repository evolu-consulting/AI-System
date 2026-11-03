// CR-114 hub-fast-sdk · SQL bước của `DirectSdkRunner` (như `dify-agent.repo`): bước `orchestrator`/`delegate` KHÔNG có hàng
// `jobs` (`job_id` NULL), `provider_key='anthropic-sdk'`, `seq` do DB cấp. Gọi trong `withHubScope(system)` (việc của chủ run);
// mở bước chỉ khi run còn `running` và còn của `owner` (`FOR SHARE`, như `enqueueJob`, H1-R14).
import type { Tx } from "@ai/db";
import { runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";
import { insertStep } from "../../../lib/run-steps";

export const DIRECT_SDK_PROVIDER_KEY = "anthropic-sdk";
const NOW_MS = sql`date_trunc('milliseconds', now())`;

export type DirectStepOpen = {
  id: string;
  runId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  type: "orchestrator" | "delegate";
  owner: string;
  /** Thử lại cùng bước (Orchestrator JSON hỏng): mở lại `running`, giữ `seq`. */
  reopen?: boolean;
  detail: Readonly<Record<string, unknown>> | null;
};

export async function openDirectStep(tx: Tx, s: DirectStepOpen): Promise<number | null> {
  const live = await tx.execute(sql`select 1 from hub.runs
    where id = ${s.runId} and status = 'running' and owner = ${s.owner} for share`);
  if (live.length === 0) return null;
  if (s.reopen) {
    const [row] = await tx
      .update(runSteps)
      .set({ status: "running", finishedAt: null })
      .where(and(eq(runSteps.id, s.id), eq(runSteps.runId, s.runId)))
      .returning({ seq: runSteps.seq });
    return row?.seq ?? null;
  }
  return insertStep(tx, {
    id: s.id,
    tenantId: s.tenantId,
    userId: s.userId,
    runId: s.runId,
    type: s.type,
    agentId: s.agentId,
    providerKey: DIRECT_SDK_PROVIDER_KEY,
    jobId: null,
    workflowId: null,
    labelKey: `step.${s.type}`,
    status: "running",
    detail: s.detail ? { ...s.detail } : null,
  });
}

export async function closeDirectStep(
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
