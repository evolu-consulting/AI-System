// HUB-FR-13, HUB-FR-89 · WRK-FR-07 · H2a-R12, R13 · P9, P10, P13 · `WorkflowJobRunner` (plan H2a §5.3): INSERT job
// `workflow.async` (+ step `workflow`, NOTIFY) một transaction → theo dõi `run:<run_id>` (lọc `job_id`) như H1 §5.6 bước 3–4
// → im 2 s thì đọc `jobs` (dựng từ DB; hết hạn `queued` tính từ `queued_at`). `job.started` (có thể lặp sau requeue) và
// `job.progress` (nhịp sống, không phát SSE) bị bỏ qua. Provider `dify` tắt/thiếu → `NOT_CONFIGURED`, không job (P9). Hạn của run là việc người gọi (`signal`), giữ qua mọi lần requeue.
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { RunEvent, WorkflowAsyncJob } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import type { Logger } from "../../../lib/logger";
import { queueTimeoutReason } from "../../runs/runs.rules";
import { EventQueue, JOB_POLL_MS } from "../job/job-agent-runner";
import { slotCounts } from "../job/runner.repo";
import type { RunStreamReader } from "../run-stream-reader";
import { eventFromJobRow, runErrorCodeOf, syntheticFailed, ZERO_USAGE } from "../runner.rules";
import * as repo from "./workflow-job.repo";

export type WorkflowJobRunnerDeps = {
  db: Db;
  /** = `HUB_INSTANCE_ID` (`runs.owner`): chỉ chủ còn giữ run mới INSERT job (H1-R14). */
  owner: string;
  reader: RunStreamReader;
  /** = `HUB_JOB_MAX_WAIT_S` (hết hạn `queued`, tính từ `queued_at`). */
  maxWaitS: number;
  log: Logger;
  pollMs?: number;
};

export type WorkflowJobTask = {
  payload: WorkflowAsyncJob;
  /** `run_steps.detail` lúc mở step (vd `extra_tokens`). */
  stepDetail: Record<string, unknown> | null;
  /** Gọi ngay sau COMMIT enqueue (N10: `step.started` không đợi `job.started`); cả khi provider tắt (không job). */
  onEnqueued: (seq: number) => Promise<void>;
};

/** `not_enqueued` = run đã đóng / không còn của mình (không ghi gì); `aborted` = `signal` abort (người gọi phân loại). */
export type WorkflowJobOutcome =
  | { kind: "result"; seq: number; text: string }
  | { kind: "failed"; seq: number; code: ChatRunErrorCode; trace: Record<string, unknown> }
  | { kind: "aborted"; seq: number }
  | { kind: "not_enqueued" };

type Live = { payload: WorkflowAsyncJob; seq: number };

/** `job.result`/`job.failed` → kết cục; sự kiện khác → null (bỏ qua). Output không phải `text` → `UPSTREAM_ERROR`. */
export function outcomeOfEvent(ev: RunEvent, seq: number): WorkflowJobOutcome | null {
  if (ev.type === "job.result") {
    if (ev.output.kind === "text") return { kind: "result", seq, text: ev.output.text };
    const trace = { code: "UPSTREAM_ERROR", reason: "invalid_output" };
    return { kind: "failed", seq, code: "UPSTREAM_ERROR", trace };
  }
  if (ev.type !== "job.failed") return null;
  const trace = { code: ev.code, reason: ev.reason, status: ev.status };
  return { kind: "failed", seq, code: runErrorCodeOf(ev.code), trace };
}

export class WorkflowJobRunner {
  constructor(private readonly d: WorkflowJobRunnerDeps) {}

  #system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn);
  }

  async run(task: WorkflowJobTask, signal: AbortSignal): Promise<WorkflowJobOutcome> {
    const p = task.payload;
    if (signal.aborted) return { kind: "not_enqueued" };
    const queue = new EventQueue();
    const unsub = await this.d.reader.subscribe(p.run_id, (e) => {
      if (e.job_id === p.job_id) queue.push(e);
    });
    try {
      const q = await this.#system((tx) =>
        repo.enqueueWorkflowJob(tx, p, this.d.owner, task.stepDetail),
      );
      if (!q) {
        this.d.log.info("workflow-job-enqueue-skipped", { run_id: p.run_id });
        return { kind: "not_enqueued" };
      }
      await task.onEnqueued(q.seq);
      if (!q.enqueued) {
        this.d.log.warn("workflow-job-provider-unavailable", { run_id: p.run_id });
        const trace = { code: "NOT_CONFIGURED", reason: "provider_disabled" };
        return { kind: "failed", seq: q.seq, code: "NOT_CONFIGURED", trace };
      }
      this.d.log.info("workflow-job-enqueued", { run_id: p.run_id, job_id: p.job_id });
      return await this.#follow({ payload: p, seq: q.seq }, queue, signal);
    } finally {
      unsub();
    }
  }

  async #follow(j: Live, queue: EventQueue, signal: AbortSignal): Promise<WorkflowJobOutcome> {
    while (!signal.aborted) {
      const ev =
        (await queue.next(this.d.pollMs ?? JOB_POLL_MS, signal)) ?? (await this.#poll(j, signal));
      if (!ev || signal.aborted) continue;
      const o = outcomeOfEvent(ev, j.seq);
      if (o) return o;
    }
    return { kind: "aborted", seq: j.seq };
  }

  /** Im `JOB_POLL_MS`: job đã kết thúc → dựng từ DB; còn `queued` quá `maxWaitS` (từ `queued_at`) → hết hạn. */
  #poll(j: Live, signal: AbortSignal): Promise<RunEvent | null> {
    if (signal.aborted) return Promise.resolve(null);
    const jobId = j.payload.job_id;
    return this.#system(async (tx) => {
      const row = await repo.readWorkflowJob(tx, jobId, this.d.maxWaitS);
      if (!row) return null;
      if (row.status !== "queued") return eventFromJobRow(jobId, row, ZERO_USAGE);
      if (!row.queueExpired) return null;
      const r = j.payload;
      const reason = queueTimeoutReason(
        await slotCounts(tx, { tenantId: r.tenant_id, providerKey: r.provider_key }),
      );
      if (!(await repo.expireWorkflowQueued(tx, jobId, reason, this.d.maxWaitS))) return null;
      const f = { code: "ALL_PROVIDERS_EXHAUSTED", reason, message: "queue wait expired" } as const;
      return syntheticFailed(jobId, f);
    });
  }
}
