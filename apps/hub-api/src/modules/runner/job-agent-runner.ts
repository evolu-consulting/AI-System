// HUB-FR-89 · HUB-FR-24 · H1-R18 · P7, P8, P11 · `JobAgentRunner` (plan H1 §5.6): kiểm `provider_state` → INSERT job +
// NOTIFY → theo dõi `run:<run_id>` (lọc `job_id`) → im 2 s thì đọc `jobs` (dựng từ DB / hết hạn `queued`) → ghi `run_steps`.
// Không biết HTTP; vòng Orchestrator (B8) gọi `run`/`runJob` với ảnh cấu hình của run (HUB-BR-06).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { HistoryItem, JobOutput, JobPayload, RunEvent, TokenUsage } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { AgentConfig, ConfigSnapshot } from "../config/config.rules";
import { stepLabel } from "../conversations/conversations.rules";
import { queueTimeoutReason } from "../runs/runs.rules";
import type { SseEventBody } from "../runs/sse/sse-writer";
import type { RunStreamReader } from "./run-stream-reader";
import * as repo from "./runner.repo";
import {
  type AgentRole,
  buildJobPayload,
  eventFromJobRow,
  isJobTerminal,
  providerBlocked,
  type RunRef,
  runErrorCodeOf,
  syntheticFailed,
  ZERO_USAGE,
} from "./runner.rules";

/** P7: im lâu hơn mức này → đọc `jobs.status`. */
export const JOB_POLL_MS = 2000;

export type AgentTask = {
  run: RunRef & { locale: "vi" | "en" };
  snapshot: ConfigSnapshot;
  agent: AgentConfig;
  role: AgentRole;
  prompt: string;
  /** Vắng → `agent.systemPrompt` (Orchestrator: B8 nối khối định dạng §6.3). */
  systemPrompt?: string;
  history: readonly HistoryItem[];
  /** `run_steps.seq` (người gọi đánh số, gồm cả step `skipped`); SSE `step_id = s<seq>` như E10/E11. */
  seq: number;
  /** `run_steps.id` do người gọi chọn (vắng → mới); `reopen` = thử lại cùng step (Orchestrator JSON hỏng, plan §6.1). */
  stepId?: string;
  reopen?: boolean;
  /** Phát `step.started`/`step.finished` (vd `writer.emit`); vắng → không phát. */
  emit?: (ev: SseEventBody) => Promise<unknown>;
};

/** plan §5.6. Sự kiện của đúng một job, kết thúc bằng `job.result`/`job.failed`; `signal` abort → dừng, không ghi gì. */
export interface AgentRunner {
  run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent>;
}

export type JobOutcome =
  | { kind: "result"; jobId: string; output: JobOutput; usage: TokenUsage }
  | { kind: "failed"; jobId: string; code: ChatRunErrorCode; usage: TokenUsage }
  | { kind: "aborted" };

export type JobAgentRunnerDeps = {
  db: Db;
  /** = `HUB_INSTANCE_ID` (`runs.owner`): chỉ chủ còn giữ run mới INSERT job (H1-R14). */
  owner: string;
  reader: RunStreamReader;
  /** = `HUB_JOB_MAX_WAIT_S` (P8). */
  maxWaitS: number;
  log: Logger;
  pollMs?: number;
};

/** Hàng đợi sự kiện một job: `next` trả sự kiện kế, null khi hết `ms` hoặc `signal` abort. */
class EventQueue {
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

const stepType = (role: AgentRole) => (role === "orchestrator" ? "orchestrator" : "delegate");

function stepInsert(
  task: AgentTask,
  stepId: string,
  owner: string,
): repo.StepInsert & { owner: string } {
  const type = stepType(task.role);
  return { stepId, seq: task.seq, type, labelKey: `step.${type}`, reopen: task.reopen, owner };
}

export class JobAgentRunner implements AgentRunner {
  constructor(private readonly d: JobAgentRunnerDeps) {}

  #system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn);
  }

  #payload(task: AgentTask, jobId: string, stepId: string): JobPayload | null {
    const profile = task.snapshot.profiles.find((p) => p.id === task.agent.profileId);
    if (!profile) return null;
    return buildJobPayload({
      jobId,
      stepId,
      run: task.run,
      agent: task.agent,
      role: task.role,
      profile,
      prompt: task.prompt,
      systemPrompt: task.systemPrompt ?? task.agent.systemPrompt,
      history: task.history,
    });
  }

  async *run(task: AgentTask, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const jobId = crypto.randomUUID();
    const stepId = task.stepId ?? crypto.randomUUID();
    const payload = this.#payload(task, jobId, stepId);
    if (!payload) {
      this.d.log.error("job-payload-invalid", { run_id: task.run.id, agent_id: task.agent.id });
      const f = {
        code: "INTERNAL_ERROR",
        reason: "invalid_payload",
        message: "invalid payload",
      } as const;
      yield syntheticFailed(jobId, f);
      return;
    }
    const state = await this.#system((tx) => repo.providerStateOf(tx, payload.provider_key));
    if (providerBlocked(state, new Date())) {
      const f = {
        code: "ALL_PROVIDERS_EXHAUSTED",
        reason: "provider_unavailable",
        message: `provider ${state?.status}`,
      } as const;
      yield syntheticFailed(jobId, f);
      return;
    }
    const queue = new EventQueue();
    const unsub = this.d.reader.subscribe(task.run.id, (e) => {
      if (e.job_id === jobId) queue.push(e);
    });
    try {
      const type = stepType(task.role);
      // Huỷ/mất lease → không INSERT job (job mồ côi giữ slot tới timeout); `runJob` quy về `aborted`.
      if (signal.aborted) return;
      const step = stepInsert(task, stepId, this.d.owner);
      if (!(await this.#system((tx) => repo.enqueueJob(tx, payload, step)))) return;
      await this.#emit(task, {
        event: "step.started",
        data: { step_id: `s${task.seq}`, label: stepLabel(type, task.run.locale) },
      });
      yield* this.#follow(
        { task, jobId, stepId, providerKey: payload.provider_key },
        queue,
        signal,
      );
    } finally {
      unsub();
    }
  }

  async *#follow(
    j: { task: AgentTask; jobId: string; stepId: string; providerKey: string },
    queue: EventQueue,
    signal: AbortSignal,
  ): AsyncGenerator<RunEvent> {
    while (!signal.aborted) {
      const ev =
        (await queue.next(this.d.pollMs ?? JOB_POLL_MS, signal)) ?? (await this.#poll(j, signal));
      if (!ev || signal.aborted) continue;
      if (isJobTerminal(ev)) {
        await this.#finishStep(j.task, j.stepId, ev);
        yield ev;
        return;
      }
      yield ev;
    }
  }

  /** P7/P8 · im `JOB_POLL_MS`: job đã kết thúc → dựng từ DB; còn `queued` quá `maxWaitS` → hết hạn (§5.6 bước 5). */
  async #poll(
    j: { task: AgentTask; jobId: string; providerKey: string },
    signal: AbortSignal,
  ): Promise<RunEvent | null> {
    if (signal.aborted) return null;
    return this.#system(async (tx) => {
      const row = await repo.readJob(tx, j.jobId, this.d.maxWaitS);
      if (!row) return null;
      if (row.status !== "queued") {
        const usage = row.status === "running" ? ZERO_USAGE : await repo.jobUsage(tx, j.jobId);
        return eventFromJobRow(j.jobId, row, usage);
      }
      if (!row.queueExpired) return null;
      const r = j.task.run;
      const reason = queueTimeoutReason(
        await repo.slotCounts(tx, { tenantId: r.tenantId, providerKey: j.providerKey }),
      );
      if (!(await repo.expireQueued(tx, j.jobId, reason))) return null;
      const f = { code: "ALL_PROVIDERS_EXHAUSTED", reason, message: "queue wait expired" } as const;
      return syntheticFailed(j.jobId, f);
    });
  }

  /** `run_steps` ok/failed (+ bản gốc lỗi Runtime vào `detail`, P11) rồi `step.finished`. */
  async #finishStep(task: AgentTask, stepId: string, ev: RunEvent): Promise<void> {
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
      repo.finishStep(tx, { stepId, runId: task.run.id, status, detail }),
    );
    if (!t) return;
    const ms = Math.max(0, t.finishedAt.getTime() - t.startedAt.getTime());
    await this.#emit(task, {
      event: "step.finished",
      data: { step_id: `s${task.seq}`, status, ms },
    });
  }

  /** Lỗi phát SSE (fencing/Redis) không dừng job; `signal` của writer báo dừng. */
  async #emit(task: AgentTask, ev: SseEventBody): Promise<void> {
    try {
      await task.emit?.(ev);
    } catch (err) {
      this.d.log.warn("step-emit-failed", { run_id: task.run.id, ...safeErrorFields(err) });
    }
  }
}

/**
 * Chạy một job tới kết thúc và quy về kết quả cho vòng Orchestrator (B8). Lỗi job → mã run (P11, không mang `message`
 * gốc); lỗi bất ngờ (DB/Redis) → `INTERNAL_ERROR`.
 */
export async function runJob(
  runner: AgentRunner,
  task: AgentTask,
  signal: AbortSignal,
  log: Logger,
): Promise<JobOutcome> {
  try {
    for await (const ev of runner.run(task, signal)) {
      if (ev.type === "job.result")
        return { kind: "result", jobId: ev.job_id, output: ev.output, usage: ev.usage };
      if (ev.type === "job.failed")
        return { kind: "failed", jobId: ev.job_id, code: runErrorCodeOf(ev.code), usage: ev.usage };
    }
  } catch (err) {
    if (signal.aborted) return { kind: "aborted" };
    log.error("job-run-failed", { run_id: task.run.id, ...safeErrorFields(err) });
    return { kind: "failed", jobId: "", code: "INTERNAL_ERROR", usage: ZERO_USAGE };
  }
  return { kind: "aborted" };
}
