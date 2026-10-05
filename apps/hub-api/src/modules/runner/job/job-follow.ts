// HUB-FR-89 · H1-R18 · P7, P8, P11 · H2c P18 (TD #52): phần theo dõi một job `agent.cli` đã vào hàng đợi, tách khỏi
// `job-agent-runner.ts` không đổi hành vi — sự kiện `run:<run_id>` (đã lọc `job_id`) qua `EventQueue`; im `JOB_POLL_MS`
// thì đọc `jobs` (dựng từ DB / hết hạn `queued`); sự kiện kết thúc → `run_steps` ok/failed + `step.finished`.
import type { RunEvent } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import { queueTimeoutReason } from "../../runs/runs.rules";
import type { SseEventBody } from "../../runs/sse/sse-writer";
import {
  blockedReason,
  eventFromJobRow,
  isJobTerminal,
  type RunRef,
  syntheticFailed,
  ZERO_USAGE,
} from "../runner.rules";
import * as repo from "./runner.repo";

/** P7: im lâu hơn mức này → đọc `jobs.status`. */
export const JOB_POLL_MS = 2000;

/** Hàng đợi sự kiện một job: `next` trả sự kiện kế, null khi hết `ms` hoặc `signal` abort. */
export class EventQueue {
  readonly #items: RunEvent[] = [];
  #wake: (() => void) | null = null;

  push(e: RunEvent): void {
    this.#items.push(e);
    this.#wake?.();
  }

  async next(ms: number, signal: AbortSignal): Promise<RunEvent | null> {
    const ready = this.#items.shift();
    if (ready || signal.aborted) return ready ?? null;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        signal.removeEventListener("abort", done);
        this.#wake = null;
        resolve();
      };
      const t = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
      this.#wake = done;
    });
    return this.#items.shift() ?? null;
  }
}

/** Phần của `AgentTask` mà việc theo dõi cần (tránh import vòng với `job-agent-runner.ts`). */
export type FollowTask = {
  run: RunRef;
  /** H2b P13 · gộp vào `run_steps.detail` lúc kết thúc step. */
  detail?: Readonly<Record<string, unknown>>;
  /** Phát `step.finished` (vd `writer.emit`); vắng → không phát. */
  emit?: (ev: SseEventBody) => Promise<unknown>;
};

export type FollowJob = {
  task: FollowTask;
  jobId: string;
  stepId: string;
  seq: number;
  providerKey: string;
};

export type JobFollowerDeps = {
  db: Db;
  /** = `HUB_JOB_MAX_WAIT_S` (P8). */
  maxWaitS: number;
  log: Logger;
  pollMs?: number;
};

/** Lỗi phát SSE (fencing/Redis) không dừng job; `signal` của writer báo dừng. */
export async function emitStep(task: FollowTask, ev: SseEventBody, log: Logger): Promise<void> {
  try {
    await task.emit?.(ev);
  } catch (err) {
    log.warn("step-emit-failed", { run_id: task.run.id, ...safeErrorFields(err) });
  }
}

export class JobFollower {
  constructor(private readonly d: JobFollowerDeps) {}

  #system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn);
  }

  async *follow(j: FollowJob, queue: EventQueue, signal: AbortSignal): AsyncGenerator<RunEvent> {
    while (!signal.aborted) {
      const ev =
        (await queue.next(this.d.pollMs ?? JOB_POLL_MS, signal)) ?? (await this.#poll(j, signal));
      if (!ev || signal.aborted) continue;
      if (isJobTerminal(ev)) {
        await this.#finishStep(j.task, { id: j.stepId, seq: j.seq }, ev);
        yield ev;
        return;
      }
      yield ev;
    }
  }

  /** P7/P8 · im `JOB_POLL_MS`: job đã kết thúc → dựng từ DB; còn `queued` quá `maxWaitS` → hết hạn (§5.6 bước 5). */
  async #poll(j: FollowJob, signal: AbortSignal): Promise<RunEvent | null> {
    if (signal.aborted) return null;
    return this.#system(async (tx) => {
      const row = await repo.readJob(tx, j.jobId, this.d.maxWaitS);
      if (!row) return null;
      if (row.status !== "queued") {
        const usage = row.status === "running" ? ZERO_USAGE : await repo.jobUsage(tx, j.jobId);
        return eventFromJobRow(j.jobId, row, usage);
      }
      if (!row.queueExpired) return null;
      const reason = await this.#expiredReason(tx, j);
      if (!(await repo.expireQueued(tx, j.jobId, reason))) return null;
      const f = { code: "ALL_PROVIDERS_EXHAUSTED", reason, message: "queue wait expired" } as const;
      return syntheticFailed(j.jobId, f);
    });
  }

  /** H3a-R06/PL12: provider đang chặn → lý do theo provider (`cooldown` → `quota`); không chặn → `queueTimeoutReason` H1. */
  async #expiredReason(
    tx: Tx,
    j: FollowJob,
  ): Promise<"quota" | "provider_unavailable" | "tenant_slots" | "provider_busy"> {
    const blocked = blockedReason(await repo.providerStateOf(tx, j.providerKey), new Date());
    if (blocked) return blocked;
    const r = j.task.run;
    return queueTimeoutReason(
      await repo.slotCounts(tx, { tenantId: r.tenantId, providerKey: j.providerKey }),
    );
  }

  /** `run_steps` ok/failed (+ bản gốc lỗi Runtime vào `detail`, P11) rồi `step.finished`. */
  async #finishStep(
    task: FollowTask,
    step: { id: string; seq: number },
    ev: RunEvent,
  ): Promise<void> {
    const failed = ev.type === "job.failed";
    const detail = failed
      ? {
          code: ev.code,
          reason: ev.reason,
          status: ev.status,
          message: ev.message,
          usage: ev.usage,
        }
      : { usage: ev.type === "job.result" ? ev.usage : ZERO_USAGE };
    const merged = { ...task.detail, ...detail };
    if (failed) {
      this.d.log.warn("job-failed", {
        run_id: task.run.id,
        job_id: ev.job_id,
        code: ev.code,
        reason: ev.reason,
        job_message: ev.message,
      });
    }
    const status = failed ? "failed" : "ok";
    const t = await this.#system((tx) =>
      repo.finishStep(tx, { stepId: step.id, runId: task.run.id, status, detail: merged }),
    );
    if (!t) return;
    const ms = Math.max(0, t.finishedAt.getTime() - t.startedAt.getTime());
    await emitStep(
      task,
      { event: "step.finished", data: { step_id: `s${step.seq}`, status, ms } },
      this.d.log,
    );
  }
}
