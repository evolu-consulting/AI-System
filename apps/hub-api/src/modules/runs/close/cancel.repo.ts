// HUB-FR-43 · H1-R13 · H1-R14 · P12 · SQL đóng run bởi bên không phải chủ — huỷ (plan H1 §5.7) và sweeper lease
// (§5.8) — theo thứ tự khoá §3.5: flows → runs → messages → jobs. Gọi trong transaction của người gọi: E15/sweeper
// `withHubScope(system)`, E9 `withHubScope(user)` (sau khoá `conversations`).
// `hub.jobs` không RLS (§3.4) ⇒ câu jobs vẫn lọc `tenant_id` tường minh (Q7).
import { JOB_CANCEL_CHANNEL, type JobCancelPayload } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { runs } from "@ai/db/schema/hub";
import { and, eq, lt, ne, type SQL, sql } from "drizzle-orm";
import * as repo from "../runs.repo";

const NOW_MS = sql`date_trunc('milliseconds', now())`;

/** Run cần đóng: đủ để khoá flow, ghi tin assistant, lọc tenant ở `jobs`. */
export type CancelTarget = {
  runId: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
  answerMessageId: string;
};
export type CloseError = { code: "CANCELLED" | "INTERNAL_ERROR"; message: string; hint: string };
export type CancelWrite = {
  target: CancelTarget;
  /** Instance đóng run chiếm `owner` trong cùng câu (P12): chủ cũ kết thúc sau đó được 0 dòng. */
  owner: string;
  error: CloseError;
  /** Nối các `delta` đã phát (C1 luật lưu). */
  content: string;
};

const targetCols = {
  runId: runs.id,
  tenantId: runs.tenantId,
  userId: runs.userId,
  conversationId: runs.conversationId,
  flowId: runs.flowId,
  answerMessageId: runs.answerMessageId,
  locale: runs.locale,
};

/** Run `running` của hội thoại (E9), theo `flow_id` để mọi E9 khoá flows cùng thứ tự. */
export async function runningRunsOf(
  tx: Tx,
  o: repo.Owner,
  conversationId: string,
): Promise<(CancelTarget & { locale: repo.Locale })[]> {
  return tx
    .select(targetCols)
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
}

/** §5.8 ứng viên sweeper, **không khoá** (`runs_lease_idx`); `locale` đọc cùng dòng (plan-errors §Ghi). */
export async function expiredLeaseRuns(
  tx: Tx,
  limit: number,
): Promise<(CancelTarget & { locale: repo.Locale })[]> {
  return tx
    .select(targetCols)
    .from(runs)
    .where(and(eq(runs.status, "running"), lt(runs.leaseUntil, sql`now()`)))
    .limit(limit);
}

/**
 * §5.7 một run: `flows FOR UPDATE` → `UPDATE runs … WHERE status='running'` (0 dòng → false, không ghi gì thêm) →
 * tin assistant → `flows.pending_ask=false` → job `queued` thành `cancelled` → job `running` đặt `cancel_requested_at` + `pg_notify('job_cancel')`.
 */
export function cancelRun(tx: Tx, w: CancelWrite): Promise<boolean> {
  return closeRun(tx, w, { status: "cancelled", where: eq(runs.status, "running") });
}

/** §5.8 · như huỷ nhưng `failed`, và chỉ khi lease **vẫn** quá hạn (chủ vừa gia hạn → 0 dòng, bỏ run đó). */
export function failExpiredRun(tx: Tx, w: CancelWrite): Promise<boolean> {
  const where = and(eq(runs.status, "running"), lt(runs.leaseUntil, sql`now()`)) as SQL;
  return closeRun(tx, w, { status: "failed", where });
}

async function closeRun(
  tx: Tx,
  w: CancelWrite,
  p: { status: "cancelled" | "failed"; where: SQL },
): Promise<boolean> {
  const t = w.target;
  await tx.execute(sql`select id from hub.flows where id = ${t.flowId} for update`);
  const [row] = await tx
    .update(runs)
    .set({
      status: p.status,
      errorCode: w.error.code,
      errorMessage: w.error.message,
      errorHint: w.error.hint,
      owner: w.owner,
      finishedAt: NOW_MS,
    })
    .where(and(eq(runs.id, t.runId), p.where))
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
  // Run đóng không có `ask` ⇒ flow không còn chờ trả lời (giữ `agent_id`).
  await repo.updateFlowAfterRun(tx, { flowId: t.flowId, pendingAsk: false });
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
