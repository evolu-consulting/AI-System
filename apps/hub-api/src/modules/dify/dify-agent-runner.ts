// HUB-FR-23 · HUB-FR-80 · H2a-R10, R11, R14, R15, R17 · `DifyAgentRunner` (plan H2a §5.4): agent `dify-workflow`/`dify-agent`
// chạy trong Hub, không hàng `jobs`. Bước `delegate` (`job_id` NULL) → workflow theo `runtime_options.workflow_key` (cache
// catalog; thiếu/tắt → `NOT_CONFIGURED`, không gọi Dify) → app-key ngay trước khi gọi (R17) → Dify streaming gom (bỏ
// `delta`) trong hạn `agents.timeout_s` → `RunEvent` tổng hợp (`job_id` = id bước): `job.started` → `job.result{agent_result:
// done{text}}` / `job.failed`. `dify-agent` đọc/ghi `cli_sessions(provider_key='dify')`. Usage `billing=dify` (`agent_id`,
// `feature_id` NULL). Huỷ run → client gọi stop, bước `failed`, không phát sự kiện kết thúc. Không log/ghi app-key.
import type { RunEvent, TokenUsage } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { CatalogSnapshot } from "../config/catalog.rules";
import { stepLabel } from "../conversations/conversations.rules";
import type { AgentRunner, AgentTask } from "../runner/job-agent-runner";
import { syntheticFailed } from "../runner/runner.rules";
import type { SseEventBody } from "../runs/sse/sse-writer";
import { type CredentialService, isCredentialError } from "./credential.service";
import type { DifyClient, DifyRunOutcome } from "./dify.client";
import { difyUser } from "./dify.rules";
import { recordDifyUsage } from "./dify.usage";
import * as repo from "./dify-agent.repo";
import {
  type DifyAgentEnd,
  difyAgentEnd,
  difyAgentRequestParts,
  difyAgentTarget,
} from "./dify-agent.rules";

export type DifyAgentRunnerDeps = {
  db: Db;
  /** = `HUB_INSTANCE_ID` (`runs.owner`). */
  owner: string;
  /** Catalog Admin hiện hành (cache, `ConfigCache.catalog`). */
  catalog: () => Promise<CatalogSnapshot>;
  /** `agents.timeout_s` theo cấu hình Hub hiện hành (như `tools/call` B8); vắng/undefined → ảnh của run. */
  currentTimeoutS?: (agentId: string) => Promise<number | undefined>;
  credentials: Pick<CredentialService, "apiKey">;
  dify: Pick<DifyClient, "runStreaming">;
  log: Logger;
};

type Step = { id: string; seq: number };
type Ran = { end: DifyAgentEnd; usage: TokenUsage; resumed: boolean };

const ZERO: TokenUsage = { input_tokens: 0, output_tokens: 0 };
const DIFY_AGENT_RUNTIME = "dify-agent";
const fail = (
  code: "NOT_CONFIGURED" | "INTERNAL_ERROR",
  reason: "credential" | null,
): DifyAgentEnd => ({ kind: "failed", code, reason, status: "failed", upstream: null });

export class DifyAgentRunner implements AgentRunner {
  constructor(private readonly d: DifyAgentRunnerDeps) {}

  #system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn);
  }

  async *run(task: AgentTask, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const id = task.stepId ?? crypto.randomUUID();
    const r = task.run;
    // Huỷ/mất lease → không mở bước (như `enqueueJob`); `runJob` quy về `aborted`.
    const seq = signal.aborted
      ? null
      : await this.#system((tx) =>
          repo.openAgentStep(tx, {
            id,
            runId: r.id,
            tenantId: r.tenantId,
            userId: r.userId,
            agentId: task.agent.id,
            owner: this.d.owner,
          }),
        );
    if (seq === null) return this.d.log.info("dify-agent-skipped", { run_id: r.id });
    const step = { id, seq };
    await this.#emit(task, {
      event: "step.started",
      data: { step_id: `s${seq}`, label: stepLabel("delegate", r.locale) },
    });
    yield startedEvent(id);
    const ran = await this.#execute(task, step, signal);
    await this.#close(task, step, ran);
    const ev = endEvent(id, ran);
    if (ev) yield ev;
  }

  /** Lỗi bất ngờ (DB/catalog) → `INTERNAL_ERROR` để bước không treo `running`. */
  async #execute(task: AgentTask, step: Step, signal: AbortSignal): Promise<Ran> {
    try {
      return await this.#call(task, step, signal);
    } catch (err) {
      this.d.log.error("dify-agent-error", { run_id: task.run.id, ...safeErrorFields(err) });
      return { end: fail("INTERNAL_ERROR", null), usage: ZERO, resumed: false };
    }
  }

  async #call(task: AgentTask, step: Step, signal: AbortSignal): Promise<Ran> {
    const { agent, run: r } = task;
    const catalog = await this.d.catalog();
    const target = difyAgentTarget(agent, catalog.workflows.values());
    const none = { usage: ZERO, resumed: false };
    if (!target.ok) {
      this.d.log.warn("dify-agent-not-configured", {
        run_id: r.id,
        agent_id: agent.id,
        failure: target.failure,
      });
      return { end: fail("NOT_CONFIGURED", null), ...none };
    }
    const wf = target.workflow;
    let apiKey: string;
    try {
      apiKey = await this.d.credentials.apiKey(wf.id);
    } catch (err) {
      if (!isCredentialError(err)) throw err;
      return { end: fail("NOT_CONFIGURED", "credential"), ...none };
    }
    const session = agent.runtime === DIFY_AGENT_RUNTIME ? await this.#session(task) : null;
    const timeout = AbortSignal.timeout((await this.#timeoutS(task)) * 1000);
    const req = {
      appType: wf.appType,
      baseUrl: wf.baseUrl,
      apiKey,
      ...difyAgentRequestParts(wf, target.inputName, task.prompt),
      user: difyUser(catalog.tenantKeys.get(r.tenantId) ?? "", r.userId),
      conversationId: session,
      outputField: wf.outputField,
    };
    const out = await this.d.dify.runStreaming(req, AbortSignal.any([signal, timeout]), () => {});
    await this.#usage(task, step, out);
    // plan-db §2: chỉ ghi phiên khi Dify xong và trả `conversation_id` (dify-workflow không có phiên).
    if (agent.runtime === DIFY_AGENT_RUNTIME && out.kind === "finished" && out.conversationId)
      await this.#save(task, out.conversationId);
    const end = difyAgentEnd(out, timeout.aborted && !signal.aborted);
    const usage = { input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens };
    return { end, usage, resumed: session !== null };
  }

  async #timeoutS(task: AgentTask): Promise<number> {
    return (await this.d.currentTimeoutS?.(task.agent.id)) ?? task.agent.timeoutS;
  }

  #session(task: AgentTask): Promise<string | null> {
    const r = task.run;
    return this.#system((tx) =>
      repo.readDifySession(tx, {
        conversationId: r.conversationId,
        agentId: task.agent.id,
        tenantId: r.tenantId,
      }),
    );
  }

  #save(task: AgentTask, sessionId: string): Promise<void> {
    const r = task.run;
    const k = { conversationId: r.conversationId, agentId: task.agent.id, tenantId: r.tenantId };
    return this.#system((tx) => repo.saveDifySession(tx, { ...k, sessionId }));
  }

  /** R15: một dòng `billing=dify` khi Dify xong hoặc đã cấp `task_id`; lỗi ghi chỉ cảnh báo. */
  async #usage(task: AgentTask, step: Step, out: DifyRunOutcome): Promise<void> {
    if (out.kind !== "finished" && !out.taskId) return;
    const r = task.run;
    try {
      await recordDifyUsage(this.d.db, {
        tenantId: r.tenantId,
        runId: r.id,
        stepId: step.id,
        userId: r.userId,
        featureId: null,
        agentId: task.agent.id,
        usage: out.usage,
        latencyMs: out.ms,
      });
    } catch (err) {
      this.d.log.warn("dify-agent-usage-failed", { run_id: r.id, ...safeErrorFields(err) });
    }
  }

  /** Bước `ok`/`failed` (+ trace đã che vào `detail`) rồi `step.finished`. */
  async #close(task: AgentTask, step: Step, ran: Ran): Promise<void> {
    const { end } = ran;
    const status = end.kind === "done" ? "ok" : "failed";
    const detail = stepDetail(ran);
    if (end.kind === "failed") {
      const f = {
        run_id: task.run.id,
        agent_id: task.agent.id,
        code: end.code,
        reason: end.reason,
      };
      this.d.log.warn("dify-agent-failed", f);
    }
    const r = task.run;
    const t = await this.#system((tx) =>
      repo.closeAgentStep(tx, { id: step.id, runId: r.id, status, detail }),
    );
    if (!t) return;
    const ms = Math.max(0, t.finishedAt.getTime() - t.startedAt.getTime());
    await this.#emit(task, {
      event: "step.finished",
      data: { step_id: `s${step.seq}`, status, ms },
    });
  }

  /** Lỗi phát SSE (fencing/Redis) không dừng bước. */
  async #emit(task: AgentTask, ev: SseEventBody): Promise<void> {
    try {
      await task.emit?.(ev);
    } catch (err) {
      this.d.log.warn("step-emit-failed", { run_id: task.run.id, ...safeErrorFields(err) });
    }
  }
}

function stepDetail(ran: Ran): Record<string, unknown> {
  const { end, usage } = ran;
  if (end.kind === "done") return { usage };
  if (end.kind === "cancelled") return { code: "CANCELLED", reason: "cancelled", usage };
  const base = { code: end.code, reason: end.reason, status: end.status, usage };
  return end.upstream ? { ...base, upstream: end.upstream } : base;
}

function startedEvent(jobId: string): RunEvent {
  const at = new Date().toISOString();
  return {
    v: 1,
    job_id: jobId,
    seq: 1,
    at,
    type: "job.started",
    worker_id: "hub",
    provider_key: "dify",
  };
}

/** `cancelled` → null (run đã đóng bởi bên huỷ; `runJob` quy về `aborted`). */
function endEvent(jobId: string, ran: Ran): RunEvent | null {
  const { end, usage } = ran;
  if (end.kind === "cancelled") return null;
  if (end.kind === "failed") {
    const f = {
      code: end.code,
      reason: end.reason,
      message: `dify ${end.code}`,
      status: end.status,
    };
    return { ...syntheticFailed(jobId, f), seq: 2, usage };
  }
  const output = { kind: "agent_result", result: { status: "done", text: end.text } } as const;
  const at = new Date().toISOString();
  return {
    v: 1,
    job_id: jobId,
    seq: 2,
    at,
    type: "job.result",
    output,
    usage,
    session_resumed: ran.resumed,
  };
}
