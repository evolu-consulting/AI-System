// HUB-FR-23 · HUB-FR-80 · H2a-R10, R11, R14, R15, R17 · `DifyAgentRunner` (plan H2a §5.4): agent `dify-workflow`/`dify-agent`
// chạy trong Hub, không hàng `jobs`. Bước `delegate` (`job_id` NULL) → workflow theo `runtime_options.workflow_key` (cache
// catalog; thiếu/tắt → `NOT_CONFIGURED`, không gọi Dify) → app-key ngay trước khi gọi (R17) → Dify streaming gom (bỏ
// `delta`) trong hạn `agents.timeout_s` → `RunEvent` tổng hợp (`job_id` = id bước): `job.started` → `job.result{agent_result:
// done{text}}` / `job.failed`. `dify-agent` đọc/ghi `cli_sessions(provider_key='dify')`. Usage `billing=dify` (`agent_id`,
// `feature_id` NULL). Huỷ run → client gọi stop, bước `failed`, không phát sự kiện kết thúc. Không log/ghi app-key.
// Phiên `dify-agent` mà Dify trả 404 (conversation lạ/đã xoá) → xoá dòng `cli_sessions` rồi thử lại đúng một lần không kèm
// `conversation_id` (REVIEW 1 Hub #5).
import type { RunEvent, TokenUsage } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import type { CatalogWorkflow } from "../../commands/catalog.types";
import { type CatalogSnapshot, tenantKeyOf } from "../../config/catalog.rules";
import { stepLabel } from "../../conversations/conversations.rules";
import {
  type ChatBinding,
  type ChatGrant,
  type ChatToolTokens,
  chatTokenTtlS,
  HUB_TOOL_TOKEN_INPUT,
} from "../../mcp/chat-token";
import type { AgentRunner, AgentTask } from "../../runner/job/job-agent-runner";
import { packToolKeys } from "../../runner/job/pack-tool-keys.rules";
import { syntheticFailed } from "../../runner/runner.rules";
import type { SseEventBody } from "../../runs/sse/sse-writer";
import { type CredentialService, isCredentialError } from "../credential.service";
import type { DifyClient, DifyRunOutcome } from "../dify.client";
import { difyUser } from "../dify.rules";
import { difyRunMeta, recordDifyRunOnly, recordDifyUsage } from "../dify.usage";
import * as repo from "./dify-agent.repo";
import {
  type DifyAgentEnd,
  difyAgentEnd,
  difyAgentRequestParts,
  difyAgentTarget,
} from "./dify-agent.rules";
import { DifyDeltaFeed } from "./dify-agent-stream";

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
  /** M2-chat · cấp token tool chat ngắn hạn (vắng ⇒ agent Dify không có tool). */
  toolTokens?: Pick<ChatToolTokens, "grant" | "refreshHandle" | "newHandle">;
};

type Step = { id: string; seq: number };
type ToolAccess = {
  tokens: NonNullable<DifyAgentRunnerDeps["toolTokens"]>;
  binding: ChatBinding;
  grant: ChatGrant;
};
type DifyRequest = Parameters<DifyClient["runStreaming"]>[0];
type Ran = { end: DifyAgentEnd; usage: TokenUsage; resumed: boolean };
/** Huỷ run + mẩu chữ Dify (P14: `job.delta` khi stream). */
type CallIo = { signal: AbortSignal; onDelta: (text: string) => void };
type StreamCall = {
  step: Step;
  io: CallIo;
  req: DifyRequest;
  timeout: AbortSignal;
  access: ToolAccess | null;
  workflowId: string; // dify-workflows: cho lịch sử chạy
};
type Resolved = {
  catalog: CatalogSnapshot;
  wf: CatalogWorkflow;
  inputName: Parameters<typeof difyAgentRequestParts>[1];
  apiKey: string;
};

const ZERO: TokenUsage = { input_tokens: 0, output_tokens: 0 };
const DIFY_AGENT_RUNTIME = "dify-agent";
const NO_DELTA = (_text: string): void => {};
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
    // P14: job được stream ⇒ mỗi mẩu chữ Dify → `job.delta{done}` tổng hợp, phát ngay khi tới.
    const feed = task.stream ? new DifyDeltaFeed(id) : null;
    const work = this.#execute(task, step, signal, feed?.push ?? NO_DELTA);
    const ran = feed ? yield* feed.follow(work) : await work;
    await this.#close(task, step, ran);
    const ev = endEvent(id, ran, (feed?.seq ?? 1) + 1);
    if (ev) yield ev;
  }

  /** Lỗi bất ngờ (DB/catalog) → `INTERNAL_ERROR` để bước không treo `running`. */
  async #execute(
    task: AgentTask,
    step: Step,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ): Promise<Ran> {
    try {
      return await this.#call(task, step, { signal, onDelta });
    } catch (err) {
      this.d.log.error("dify-agent-error", { run_id: task.run.id, ...safeErrorFields(err) });
      return { end: fail("INTERNAL_ERROR", null), usage: ZERO, resumed: false };
    }
  }

  /** Workflow + app-key (R17) ngay trước khi gọi; thiếu ⇒ kết quả `NOT_CONFIGURED` (không gọi Dify). */
  async #resolve(task: AgentTask): Promise<Resolved | { ran: Ran }> {
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
      return { ran: { end: fail("NOT_CONFIGURED", null), ...none } };
    }
    const wf = target.workflow;
    try {
      const apiKey = await this.d.credentials.apiKey(wf.id);
      return { catalog, wf, inputName: target.inputName, apiKey };
    } catch (err) {
      if (!isCredentialError(err)) throw err;
      return { ran: { end: fail("NOT_CONFIGURED", "credential"), ...none } };
    }
  }

  async #call(task: AgentTask, step: Step, io: CallIo): Promise<Ran> {
    const { agent, run: r } = task;
    const got = await this.#resolve(task);
    if ("ran" in got) return got.ran;
    const { catalog, wf, apiKey } = got;
    let session = agent.runtime === DIFY_AGENT_RUNTIME ? await this.#session(task) : null;
    const timeoutS = await this.#timeoutS(task);
    const timeout = AbortSignal.timeout(timeoutS * 1000);
    const parts = difyAgentRequestParts(wf, got.inputName, task.prompt);
    // M2-chat · m2c (A-5): grant tool cho run này (thu hồi khi run xong); handle chỉ gửi khi MỞ hội thoại Dify (Dify giữ
    // `inputs` lượt đầu). Handle cũ hết hạn ⇒ bỏ phiên Dify, mở hội thoại mới kèm handle mới.
    const access = await this.#toolAccess(task, wf, timeoutS);
    try {
      if (access && session && !(await access.tokens.refreshHandle(access.binding))) {
        await this.#forget(task);
        session = null;
      }
      if (access && !session)
        parts.inputs[HUB_TOOL_TOKEN_INPUT] = await access.tokens.newHandle(access.binding);
      const req: DifyRequest = {
        appType: wf.appType,
        baseUrl: wf.baseUrl,
        apiKey,
        ...parts,
        user: difyUser(tenantKeyOf(catalog, r.tenantId), r.userId),
        conversationId: session,
        outputField: wf.outputField,
      };
      return await this.#stream(task, { step, io, req, timeout, access, workflowId: wf.id });
    } finally {
      await access?.grant
        .revoke()
        .catch((err) =>
          this.d.log.warn("chat-token-revoke-failed", { run_id: r.id, ...safeErrorFields(err) }),
        );
    }
  }

  /** M2-chat · grant khi agent khai `pack_tools` VÀ app Dify có input `hub_tool_token` (cấu hình, không code). */
  async #toolAccess(task: AgentTask, wf: CatalogWorkflow, timeoutS: number) {
    const tokens = this.d.toolTokens;
    const keys = packToolKeys(task.agent.runtimeOptions);
    if (!tokens || keys.length === 0) return null;
    if (!wf.inputSchema.some((i) => i.name === HUB_TOOL_TOKEN_INPUT)) return null;
    const r = task.run;
    const binding = {
      tenantId: r.tenantId,
      userId: r.userId,
      conversationId: r.conversationId,
      agentId: task.agent.id,
    };
    const grant = await tokens.grant({ ...binding, runId: r.id }, keys, chatTokenTtlS(timeoutS));
    return grant ? { tokens, binding, grant } : null;
  }
  async #stream(task: AgentTask, c: StreamCall): Promise<Ran> {
    const { step, io, req, timeout, access, workflowId } = c;
    const { agent, run: r } = task;
    const session = req.conversationId;
    const both = AbortSignal.any([io.signal, timeout]);
    let out = await this.d.dify.runStreaming(req, both, io.onDelta);
    await this.#usage(task, step, out, workflowId);
    let resumed = session !== null;
    if (resumed && isStaleSession(out) && !both.aborted) {
      await this.#forget(task);
      this.d.log.warn("dify-agent-session-stale", { run_id: r.id, agent_id: agent.id });
      // Hội thoại Dify mới ⇒ handle mới (Dify sẽ giữ inputs của lượt mở này).
      const inputs = access
        ? { ...req.inputs, [HUB_TOOL_TOKEN_INPUT]: await access.tokens.newHandle(access.binding) }
        : req.inputs;
      out = await this.d.dify.runStreaming(
        { ...req, inputs, conversationId: null },
        both,
        io.onDelta,
      );
      await this.#usage(task, step, out, workflowId);
      resumed = false;
    }
    // plan-db §2: chỉ ghi phiên khi Dify xong và trả `conversation_id` (dify-workflow không có phiên).
    if (agent.runtime === DIFY_AGENT_RUNTIME && out.kind === "finished" && out.conversationId)
      await this.#save(task, out.conversationId);
    const end = difyAgentEnd(out, timeout.aborted && !io.signal.aborted);
    const usage = { input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens };
    return { end, usage, resumed };
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

  /** Phiên Dify không còn (404) → xoá để lượt sau không gửi lại. */
  #forget(task: AgentTask): Promise<void> {
    const r = task.run;
    const k = { conversationId: r.conversationId, agentId: task.agent.id, tenantId: r.tenantId };
    return this.#system((tx) => repo.deleteDifySession(tx, k));
  }

  /** R15: một dòng `billing=dify` khi Dify xong hoặc đã cấp `task_id`; lỗi ghi chỉ cảnh báo. */
  async #usage(
    task: AgentTask,
    step: Step,
    out: DifyRunOutcome,
    workflowId: string,
  ): Promise<void> {
    const noTask = out.kind !== "finished" && !out.taskId;
    const r = task.run;
    try {
      await (noTask ? recordDifyRunOnly : recordDifyUsage)(this.d.db, {
        tenantId: r.tenantId,
        runId: r.id,
        stepId: step.id,
        userId: r.userId,
        featureId: null,
        agentId: task.agent.id,
        usage: out.usage,
        latencyMs: out.ms,
        run: difyRunMeta(out, workflowId, "agent"),
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
        ...(end.upstream && { upstream: end.upstream }),
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

/** Dify 404 với thân lỗi "Conversation Not Exists" (`{"code":"not_found","message":"Conversation Not Exists."}`)
 * = phiên lạ/đã xoá phía Dify. 404 khác (sai base_url, app xoá…) giữ phiên, trả lỗi như cũ (REVIEW 2). */
function isStaleSession(out: DifyRunOutcome): boolean {
  return (
    out.kind === "failed" &&
    out.httpStatus === 404 &&
    (out.detail ?? "").toLowerCase().includes("conversation not exist")
  );
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
function endEvent(jobId: string, ran: Ran, seq: number): RunEvent | null {
  const { end, usage } = ran;
  if (end.kind === "cancelled") return null;
  if (end.kind === "failed") {
    const f = {
      code: end.code,
      reason: end.reason,
      message: `dify ${end.code}`,
      status: end.status,
    };
    return { ...syntheticFailed(jobId, f), seq, usage };
  }
  const output = { kind: "agent_result", result: { status: "done", text: end.text } } as const;
  const at = new Date().toISOString();
  return {
    v: 1,
    job_id: jobId,
    seq,
    at,
    type: "job.result",
    output,
    usage,
    session_resumed: ran.resumed,
  };
}
