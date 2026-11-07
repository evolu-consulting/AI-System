// CR-114 hub-fast-sdk · `DirectSdkRunner`: lượt chat ngắn của agent đủ điều kiện (`direct-sdk.rules`) chạy bằng Anthropic SDK
// TRONG Hub — không hàng `jobs`, không spawn CLI. Cùng hợp đồng `AgentRunner` như `DifyAgentRunner`: bước `run_steps`
// (`withHubScope(system)`, chỉ chủ run còn giữ lease), `step.started/finished`, `RunEvent` tổng hợp (`job_id` = id bước):
// `job.started` → `job.delta{done}` (chỉ vai `agent` được stream; Orchestrator trả JSON quyết định ⇒ không delta) →
// `job.result` / `job.failed`. `runJob` chuyển delta qua `DeltaSink` sẵn có và ghi usage chat như đường job. Trần ngày: `gatedRun`
// (cùng cửa giữ chỗ với job chat); trần tốc độ token/phút: `TokenBucket` (fail-open). Prompt cache: `cachedPrompt` (dòng giờ
// sau breakpoint cuối). Không log nội dung lời nhắc/đầu ra.
import { JOB_DELTA_TEXT_MAX, type RunEvent, type TokenUsage } from "@ai/contracts/hub";
import { estimateInputTokens } from "../../../lib/ai-client/ai-client";
import type { TurnReply, TurnStreamer } from "../../../lib/ai-client/anthropic.provider";
import {
  blockWindowDrop,
  cachedPrompt,
  historyBlock,
  promptTokens,
} from "../../../lib/ai-client/prompt-cache";
import type { TokenBucket } from "../../../lib/ai-client/token-bucket";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import { stepLabel } from "../../conversations/conversations.rules";
import type { SseEventBody } from "../../runs/public";
import { chunkDelta } from "../../stream/delta.rules";
import { type ChatTokenGate, gatedRun } from "../../usage/chat-token-gate";
import type { AgentRunner, AgentTask } from "../job/job-agent-runner.types";
import { nowLine } from "../job/now-line.rules";
import { syntheticFailed } from "../runner.rules";
import { DIRECT_SDK_PROVIDER_KEY, type DirectStepOpen } from "./direct-sdk.repo";
import { directSdkModel } from "./direct-sdk.rules";

/** Lượt chat ngắn: trần output (non-tool). */
export const DIRECT_SDK_MAX_TOKENS = 16_000;

export type DirectSteps = {
  open(s: Omit<DirectStepOpen, "owner">): Promise<number | null>;
  close(p: {
    id: string;
    runId: string;
    status: "ok" | "failed";
    detail: Record<string, unknown>;
  }): Promise<{ startedAt: Date; finishedAt: Date } | null>;
};

export type DirectSdkRunnerDeps = {
  steps: DirectSteps;
  stream: TurnStreamer;
  log: Logger;
  tokenGate?: ChatTokenGate;
  rate?: TokenBucket;
  /** `HUB_DIRECT_SDK_MODEL`. */
  envModel?: string;
  timeZoneOf?: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

type Usage = TokenUsage;
const EFFORTS = new Set(["low", "medium", "high"]);

/** Hàng đợi `job.delta` phát ngay khi SDK đẩy chữ (như `DifyDeltaFeed`, P14). */
class DeltaFeed {
  readonly #items: RunEvent[] = [];
  #wake: (() => void) | null = null;
  seq = 1;
  constructor(private readonly jobId: string) {}
  readonly push = (text: string): void => {
    for (const part of chunkDelta(text, JOB_DELTA_TEXT_MAX)) {
      this.seq += 1;
      const at = new Date().toISOString();
      const ev = { v: 1, job_id: this.jobId, seq: this.seq, at, type: "job.delta" } as const;
      this.#items.push({ ...ev, kind: "done", text: part });
    }
    const w = this.#wake;
    this.#wake = null;
    w?.();
  };
  async *follow<T>(work: Promise<T>): AsyncGenerator<RunEvent, T> {
    let done = false;
    const settled = work.finally(() => {
      done = true;
      this.push("");
    });
    for (;;) {
      while (this.#items.length > 0) yield this.#items.shift() as RunEvent;
      if (done) break;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    return await settled;
  }
}

export class DirectSdkRunner implements AgentRunner {
  constructor(private readonly d: DirectSdkRunnerDeps) {}

  run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent> {
    return gatedRun(this.d.tokenGate, task, this.d.log, () => this.#run(task, signal));
  }

  async *#run(task: AgentTask, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const id = task.stepId ?? crypto.randomUUID();
    const r = task.run;
    const system = task.systemPrompt ?? task.agent.systemPrompt;
    const want =
      estimateInputTokens({
        system,
        prompt: [task.prompt, ...task.history.map((h) => h.content)].join("\n"),
      }) + DIRECT_SDK_MAX_TOKENS;
    if (this.d.rate && !(await this.d.rate.take(r.tenantId, want)).ok) {
      this.d.log.warn("direct-sdk-rate-limited", { run_id: r.id, tenant_id: r.tenantId });
      const f = { code: "ALL_PROVIDERS_EXHAUSTED", reason: "provider_busy" } as const;
      yield syntheticFailed(id, { ...f, message: "tenant token rate exceeded" });
      return;
    }
    const type = task.role === "orchestrator" ? "orchestrator" : "delegate";
    const seq = signal.aborted
      ? null
      : await this.d.steps.open({
          id,
          runId: r.id,
          tenantId: r.tenantId,
          userId: r.userId,
          agentId: task.agent.id,
          type,
          ...(task.reopen ? { reopen: true } : {}),
          detail: task.detail ?? null,
        });
    if (seq === null) return this.d.log.info("direct-sdk-skipped", { run_id: r.id });
    await this.#emit(task, {
      event: "step.started",
      data: { step_id: `s${seq}`, label: stepLabel(type, r.locale) },
    });
    yield startedEvent(id);
    const feed = task.stream && task.role === "agent" ? new DeltaFeed(id) : null;
    const work = this.#call(task, system, signal, feed?.push);
    const reply = feed ? yield* feed.follow(work) : await work;
    const usage = usageOf(reply);
    const cancelled = signal.aborted;
    await this.#close(task, { id, seq }, reply, cancelled);
    if (cancelled) return; // run đã đóng bởi bên huỷ; `runJob` quy về `aborted`
    yield endEvent(id, task, reply, usage, (feed?.seq ?? 1) + 1);
  }

  async #call(
    task: AgentTask,
    system: string,
    signal: AbortSignal,
    onText?: (t: string) => void,
  ): Promise<TurnReply> {
    try {
      const o = task.agent.runtimeOptions;
      const effort = typeof o.effort === "string" && EFFORTS.has(o.effort) ? o.effort : "low";
      const timeout = AbortSignal.timeout(Math.max(1, task.agent.timeoutS) * 1000);
      const volatile = await this.#nowLine(task);
      return await this.d.stream({
        model: directSdkModel(o, task.agent.model, this.d.envModel),
        prompt: cachedPrompt({
          system,
          history: blockHistory(task),
          prompt: task.prompt,
          ...(volatile ? { volatile } : {}),
        }),
        maxTokens: DIRECT_SDK_MAX_TOKENS,
        effort: effort as "low" | "medium" | "high",
        signal: AbortSignal.any([signal, timeout]),
        ...(onText ? { onText } : {}),
      });
    } catch (err) {
      this.d.log.error("direct-sdk-error", { run_id: task.run.id, ...safeErrorFields(err) });
      return { ok: false, code: "FAILED" };
    }
  }

  /** Agent chat ⇒ dòng ngày giờ theo múi tenant (phần biến động, sau breakpoint cache); lỗi ⇒ bỏ qua. */
  async #nowLine(task: AgentTask): Promise<string | null> {
    if (task.role !== "agent" || !this.d.timeZoneOf) return null;
    try {
      const now = (this.d.now ?? (() => new Date()))();
      return nowLine(now, await this.d.timeZoneOf(task.run.tenantId));
    } catch {
      return null;
    }
  }

  async #close(
    task: AgentTask,
    step: { id: string; seq: number },
    reply: TurnReply,
    cancelled: boolean,
  ): Promise<void> {
    const status = reply.ok && !cancelled ? "ok" : "failed";
    const u = reply.usage;
    const detail: Record<string, unknown> = {
      ...(task.detail ?? {}),
      provider: DIRECT_SDK_PROVIDER_KEY,
      ...(reply.model ? { model: reply.model } : {}),
      usage: {
        input_tokens: u?.inputTokens ?? 0,
        output_tokens: u?.outputTokens ?? 0,
        cache_read_input_tokens: u?.cacheReadTokens ?? 0,
        cache_creation_input_tokens: u?.cacheWriteTokens ?? 0,
      },
      ...(reply.ok ? {} : { code: cancelled ? "CANCELLED" : reply.code }),
    };
    if (!reply.ok && !cancelled)
      this.d.log.warn("direct-sdk-failed", {
        run_id: task.run.id,
        agent_id: task.agent.id,
        code: reply.code,
      });
    try {
      const t = await this.d.steps.close({ id: step.id, runId: task.run.id, status, detail });
      if (!t) return;
      const ms = Math.max(0, t.finishedAt.getTime() - t.startedAt.getTime());
      await this.#emit(task, {
        event: "step.finished",
        data: { step_id: `s${step.seq}`, status, ms },
      });
    } catch (err) {
      this.d.log.warn("direct-sdk-close-failed", { run_id: task.run.id, ...safeErrorFields(err) });
    }
  }

  async #emit(task: AgentTask, ev: SseEventBody): Promise<void> {
    try {
      await task.emit?.(ev);
    } catch (err) {
      this.d.log.warn("step-emit-failed", { run_id: task.run.id, ...safeErrorFields(err) });
    }
  }
}

/** Cửa sổ history dịch theo khối (biết tổng tin của flow) ⇒ tiền tố cache giữ nguyên qua một khối lượt. */
export function blockHistory(task: Pick<AgentTask, "history" | "historyTotal">) {
  const n = task.history.length;
  if (task.historyTotal === undefined) return task.history;
  return task.history.slice(blockWindowDrop(task.historyTotal, n, historyBlock(n)));
}

/** Trần ngày đếm cả token đọc/ghi cache (không đếm thiếu khi trúng cache). */
function usageOf(reply: TurnReply): Usage {
  const u = reply.usage;
  if (!u) return { input_tokens: 0, output_tokens: 0 };
  const input = promptTokens({
    input_tokens: u.inputTokens,
    cache_read_input_tokens: u.cacheReadTokens,
    cache_creation_input_tokens: u.cacheWriteTokens,
  });
  return { input_tokens: input, output_tokens: u.outputTokens };
}

function startedEvent(jobId: string): RunEvent {
  const at = new Date().toISOString();
  const ev = { v: 1, job_id: jobId, seq: 1, at, type: "job.started", worker_id: "hub" } as const;
  return { ...ev, provider_key: DIRECT_SDK_PROVIDER_KEY };
}

function endEvent(
  jobId: string,
  task: AgentTask,
  reply: TurnReply,
  usage: Usage,
  seq: number,
): RunEvent {
  if (!reply.ok) {
    const f =
      reply.code === "REFUSED"
        ? ({ code: "UPSTREAM_ERROR", reason: "refused" } as const)
        : reply.code === "UNAVAILABLE"
          ? ({ code: "NOT_CONFIGURED", reason: "credential" } as const)
          : ({ code: "UPSTREAM_ERROR", reason: "upstream" } as const);
    return { ...syntheticFailed(jobId, { ...f, message: `sdk ${reply.code}` }), seq, usage };
  }
  const output =
    task.role === "orchestrator"
      ? ({ kind: "text", text: reply.text } as const)
      : ({ kind: "agent_result", result: { status: "done", text: reply.text } } as const);
  const at = new Date().toISOString();
  return {
    v: 1,
    job_id: jobId,
    seq,
    at,
    type: "job.result",
    output,
    usage,
    session_resumed: false,
  };
}
