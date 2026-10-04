// HUB-FR-43 · H1-R14 · P12 · SQL huỷ run (plan H1 §5.7) theo thứ tự khoá §3.5: flows → runs → messages → jobs.
// Gọi trong transaction của người gọi: E15 `withHubScope(system)`, E9 `withHubScope(user)` (sau khoá `conversations`).
// `hub.jobs` không RLS (§3.4) ⇒ câu jobs vẫn lọc `tenant_id` tường minh (Q7).
import { JOB_CANCEL_CHANNEL, type JobCancelPayload } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { runs } from "@ai/db/schema/hub";
import { and, eq, ne, sql } from "drizzle-orm";
import * as repo from "./runs.repo";

const NOW_MS = sql`date_trunc('milliseconds', now())`;

/** Run cần huỷ: đủ để khoá flow, ghi tin assistant, lọc tenant ở `jobs`. */
export type CancelTarget = {
  runId: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
  answerMessageId: string;
};
export type CancelWrite = {
  target: CancelTarget;
  /** Instance huỷ chiếm `owner` trong cùng câu (P12): chủ cũ kết thúc sau đó được 0 dòng. */
  owner: string;
  error: { code: "CANCELLED"; message: string; hint: string };
  /** Nối các `delta` đã phát (C1 luật lưu). */
  content: string;
};

/** Run `running` của hội thoại (E9), theo `flow_id` để mọi E9 khoá flows cùng thứ tự. */
export async function runningRunsOf(
  tx: Tx,
  o: repo.Owner,
  conversationId: string,
): Promise<(CancelTarget & { locale: repo.Locale })[]> {
  const rows = await tx
    .select({
      runId: runs.id,
      tenantId: runs.tenantId,
      userId: runs.userId,
      conversationId: runs.conversationId,
      flowId: runs.flowId,
      answerMessageId: runs.answerMessageId,
      locale: runs.locale,
    })
    .from(runs)
    .where(
      and(
        eq(runs.tenantId, o.tenantId),
        eq(runs.userId, o.userId),
        eq(runs.conversationId, conversationId),
        eq(runs.status, "running"),
      ),
    )
    .orderBy(runs.flowId);
  return rows;
}

/**
 * §5.7 một run: `flows FOR UPDATE` → `UPDATE runs … WHERE status='running'` (0 dòng → false, không ghi gì thêm) →
 * tin assistant → job `queued` thành `cancelled` → job `running` đặt `cancel_requested_at` + `pg_notify('job_cancel')`.
 */
export async function cancelRun(tx: Tx, w: CancelWrite): Promise<boolean> {
  const t = w.target;
  await tx.execute(sql`select id from hub.flows where id = ${t.flowId} for update`);
  const [row] = await tx
    .update(runs)
    .set({
      status: "cancelled",
      errorCode: w.error.code,
      errorMessage: w.error.message,
      errorHint: w.error.hint,
      owner: w.owner,
      finishedAt: NOW_MS,
    })
    .where(and(eq(runs.id, t.runId), eq(runs.status, "running")))
    .returning({ id: runs.id });
  if (!row) return false;
  await repo.insertMessage(
    tx,
    { tenantId: t.tenantId, userId: t.userId },
    {
      id: t.answerMessageId,
      conversationId: t.conversationId,
      flowId: t.flowId,
      role: "assistant",
      content: w.content,
      runId: t.runId,
    },
  );
  await cancelJobs(tx, t);
  return true;
}

async function cancelJobs(tx: Tx, t: CancelTarget): Promise<void> {
  await tx.execute(sql`update hub.jobs set status = 'cancelled', cancel_requested_at = now(),
    finished_at = now() where run_id = ${t.runId} and tenant_id = ${t.tenantId} and status = 'queued'`);
  const running = await tx.execute<{
    id: string;
  }>(sql`update hub.jobs set cancel_requested_at = now()
    where run_id = ${t.runId} and tenant_id = ${t.tenantId} and status = 'running'
      and cancel_requested_at is null returning id`);
  for (const { id } of running) {
    const note: JobCancelPayload = { v: 1, job_id: id, run_id: t.runId };
    await tx.execute(sql`select pg_notify(${JOB_CANCEL_CHANNEL}, ${JSON.stringify(note)})`);
  }
}

/** Sau "XADD bên ngoài": `last_seq` = id sự kiện kết thúc (E14 đọc). Run đã kết thúc ⇒ không đụng index `running`. */
export async function setFinalSeq(tx: Tx, runId: string, seq: number): Promise<void> {
  await tx
    .update(runs)
    .set({ lastSeq: sql`greatest(${runs.lastSeq}, ${seq})` })
    .where(and(eq(runs.id, runId), ne(runs.status, "running")));
}
