// HUB-FR-89 · H1-R20 · WRK-BR-04 · quét orphan phía Hub (plan-db §5.5, mỗi 10 s): job `running` mất heartbeat > 60 s
// → `failed reason=orphaned`; Hub nhận dòng thì XADD `job.failed` vào `run:<run_id>` (Runtime chạy cùng câu, chỉ một bên
// nhận được). Chủ run nhận qua `RunStreamReader` (hoặc dựng từ DB sau 2 s im, §5.6) → `run.failed INTERNAL_ERROR`.
// Chủ run đã chết → sweeper lease (§5.8) đóng run.
// H2a (R13, AC-W06, plan-db §2): trước câu `failed`, cùng transaction, job `workflow.async` đủ điều kiện được đưa lại
// `queued` (+ NOTIFY `job_enqueued`, không XADD) — chủ run vẫn đợi (hạn run giữ qua requeue, §5.3).
import { RUN_STREAM_FIELD, type RunEvent, runStreamKey } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import type { Redis } from "../../lib/redis";
import { type OrphanJob, requeueOrphanJobs, sweepOrphanJobs } from "./runner.repo";
import { syntheticFailed } from "./runner.rules";

export const ORPHAN_SWEEP_MS = 10_000;
/** Như Runtime (`publish_run_event`): MAXLEN ~ 10000, TTL 24 h. */
const RUN_STREAM_MAXLEN = 10_000;
const RUN_STREAM_TTL_S = 86_400;

export type OrphanSweepDeps = { db: Db; redis: Redis; log: Logger };

/** Job không do tiến trình này đếm `seq` ⇒ `seq` = epoch ms (luôn lớn hơn bộ đếm của worker đã chết), như Runtime. */
export function orphanEvent(jobId: string, now = new Date()): RunEvent {
  const ev = syntheticFailed(
    jobId,
    { code: "INTERNAL_ERROR", reason: "orphaned", message: "job orphaned (heartbeat lost)" },
    now,
  );
  return { ...ev, seq: now.getTime() };
}

async function publish(redis: Redis, job: OrphanJob): Promise<void> {
  const key = runStreamKey(job.runId);
  const body = JSON.stringify(orphanEvent(job.id));
  await redis.xadd(key, "MAXLEN", "~", RUN_STREAM_MAXLEN, "*", RUN_STREAM_FIELD, body);
  await redis.expire(key, RUN_STREAM_TTL_S);
}

/** Một lượt. Trả job đã đánh dấu `failed` (job requeue chỉ log). Redis lỗi → log (chủ run vẫn dựng `job.failed` từ DB, §5.6 bước 4). */
export async function sweepOrphans(d: OrphanSweepDeps): Promise<OrphanJob[]> {
  const { requeued, jobs } = await withHubScope(d.db, { kind: "system" }, async (tx) => ({
    requeued: await requeueOrphanJobs(tx),
    jobs: await sweepOrphanJobs(tx),
  }));
  for (const job of requeued) d.log.warn("job-requeued", { job_id: job.id, run_id: job.runId });
  for (const job of jobs) {
    d.log.warn("job-orphaned", { job_id: job.id, run_id: job.runId });
    await publish(d.redis, job).catch((err) =>
      d.log.warn("job-orphan-publish-failed", { job_id: job.id, ...safeErrorFields(err) }),
    );
  }
  return jobs;
}

export function startOrphanSweep(d: OrphanSweepDeps & { signal?: AbortSignal }): void {
  startLoop({
    name: "job-orphan-sweep",
    everyMs: ORPHAN_SWEEP_MS,
    tick: () => sweepOrphans(d),
    log: d.log,
    signal: d.signal,
  });
}
