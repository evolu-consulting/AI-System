// HUB-FR-89 · HUB-FR-24 · H1-R18 · P7, P8, P11 · `JobAgentRunner` (plan H1 §5.6): kiểm `provider_state` → INSERT job +
// NOTIFY → theo dõi `run:<run_id>` (lọc `job_id`) → im 2 s thì đọc `jobs` (dựng từ DB / hết hạn `queued`) → ghi `run_steps`.
// Không biết HTTP; vòng Orchestrator (B8) gọi `run`/`runJob` với ảnh cấu hình của run (HUB-BR-06).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import {
  type AgentCliJob,
  type HistoryItem,
  type JobFailReason,
  type JobOutput,
  type JobSource,
  type JobSourceRead,
  MCP_TOOLS_MAX,
  type McpConfig,
  type RunEvent,
  SYSTEM_PROMPT_MAX,
  type TokenUsage,
} from "@ai/contracts/hub";
import { KH_TOOL_KEY } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import {
  agentFilesBlock,
  jobAttachments,
  type RunFile,
  withOutHint,
} from "../../attachments/run-files.rules";
import type { CatalogSnapshot } from "../../config/catalog.rules";
import {
  type AgentConfig,
  agentWorkflowIds,
  type ConfigSnapshot,
  type ProfileConfig,
} from "../../config/config.rules";
import { stepLabel } from "../../conversations/conversations.rules";
import type { KhJobItem } from "../../kh/kh.agent.rules";
import { KH_QUERY_HINT, type KhJobPreparer } from "../../kh/kh.job";
import { mcpToolsFor } from "../../mcp/mcp.rules";
import type { SseEventBody } from "../../runs/sse/sse-writer";
import type { DeltaGap, DeltaSink } from "../../stream/delta-sink";
import type { RunStreamReader } from "../run-stream-reader";
import {
  type AgentRole,
  buildJobPayload,
  mcpConfigFor,
  type RunRef,
  runErrorCodeOf,
  syntheticFailed,
  ZERO_USAGE,
} from "../runner.rules";
import { EventQueue, emitStep, JobFollower } from "./job-follow";
import { chooseJobStep, type JobStep, stepProviderKeys } from "./job-step.rules";
import * as repo from "./runner.repo";

/** TD #52 (H2c P18): giữ đường import cũ cho người gọi (`workflow-job-runner.ts`). */
export { EventQueue, JOB_POLL_MS } from "./job-follow";

export type AgentTask = {
  run: RunRef & { locale: "vi" | "en" };
  snapshot: ConfigSnapshot;
  agent: AgentConfig;
  role: AgentRole;
  prompt: string;
  /** Vắng → `agent.systemPrompt` (Orchestrator: B8 nối khối định dạng §6.3). */
  systemPrompt?: string;
  history: readonly HistoryItem[];
  /** H2b P11 · có ⇒ `payload.stream=true`, `runJob` chuyển `job.delta` qua sink (plan §5.5); vắng = không stream. */
  stream?: DeltaSink;
  /** `run_steps.id` do người gọi chọn (vắng → mới); `reopen` = thử lại cùng step (Orchestrator JSON hỏng, plan §6.1). */
  stepId?: string;
  reopen?: boolean;
  /** H2b P13 · gộp vào `run_steps.detail` (lúc tạo và lúc kết thúc step), vd `{scope}` (R09). */
  detail?: Readonly<Record<string, unknown>>;
  /** H2c P9 · tập file của run (`RunContext.files`); chỉ job vai `agent` dùng (P10); vắng/rỗng = như H2b. */
  files?: readonly RunFile[];
  /** P-b PB-R10 · nguồn chỉ-đọc của stage (git/library/local đã ghim); có ⇒ payload.sources + Read/Grep/Glob. */
  sources?: readonly JobSource[];
  /** P-b2 R12 · job stage quy trình: `false` ⇒ `payload.use_session=false` (Hub tự quyết resume); vắng ⇒ như cũ. */
  useSession?: boolean;
  /** K1 plan §3.4 bước 0 · `stage_runs.id` do launcher stage truyền (đơn + mọi job nhóm); vắng ⇒ không phải job stage ⇒ không KH. */
  stageRunId?: string;
  /** Phát `step.started`/`step.finished` (vd `writer.emit`); vắng → không phát. */
  emit?: (ev: SseEventBody) => Promise<unknown>;
};

/** plan §5.6. Sự kiện của đúng một job, kết thúc bằng `job.result`/`job.failed`; `signal` abort → dừng, không ghi gì. */
export interface AgentRunner {
  run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent>;
}

/** H2b P11 · phần đã phát (S), `seq` hở (nếu có) và step của job (để ghi trace). */
export type JobStreamed = { streamed: string; gap: DeltaGap | null; stepId: string };

export type JobOutcome =
  | ({
      kind: "result";
      jobId: string;
      output: JobOutput;
      usage: TokenUsage;
      /** P-b C18 · file nguồn Runtime đã đọc (từ `job.result.source_reads`); Hub ghi audit + kiểm `## Nguồn tham chiếu`. */
      sourceReads?: readonly JobSourceRead[];
    } & JobStreamed)
  | ({
      kind: "failed";
      jobId: string;
      code: ChatRunErrorCode;
      reason: JobFailReason | null;
      usage: TokenUsage;
    } & JobStreamed)
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
  /** H2a · MCP cho agent gắn workflow (R18): `url` = `HUB_PUBLIC_INTERNAL_URL + "/mcp"`; vắng → `mcp: null`. */
  mcp?: { url: string; catalog: () => Promise<CatalogSnapshot> };
  /** K1 · `khPrepareJob` (KH của job stage); vắng ⇒ không `kh-query`. */
  kh?: KhJobPreparer;
};

/** `payload.mcp` + KH của job (`kh_jobs.items`; [] ⇒ không `kh-query`). */
type JobMcp = { mcp: McpConfig | null; khItems: KhJobItem[] };
const NO_MCP: JobMcp = { mcp: null, khItems: [] };

/** H2c P9–P11 · file của job: chỉ vai `agent` (Orchestrator thấy khối `<attachments>` trong prompt, không `payload.attachments`). */
const agentFiles = (task: AgentTask): readonly RunFile[] =>
  task.role === "agent" ? (task.files ?? []) : [];

const stepType = (role: AgentRole) => (role === "orchestrator" ? "orchestrator" : "delegate");

function stepInsert(
  task: AgentTask,
  stepId: string,
  owner: string,
): repo.StepInsert & { owner: string } {
  const type = stepType(task.role);
  return {
    stepId,
    type,
    labelKey: `step.${type}`,
    reopen: task.reopen,
    owner,
    detail: task.detail ?? null,
  };
}

/**
 * R19 (phía payload): workflow gắn agent ∩ `enabled`, sắp key, ≤ `MCP_TOOLS_MAX`.
 * H2c P12: `hasFiles` chuyển cho `mcpToolsFor` (vắng → H2a nguyên văn; Hub luôn truyền = run có file).
 */
export function agentToolKeys(
  ids: ReadonlySet<string>,
  catalog: CatalogSnapshot,
  hasFiles?: boolean,
): string[] {
  const workflows = [...catalog.workflows.values()];
  const allowed = workflows.map((w) => w.key);
  const input = { agentWorkflowIds: ids, workflows, allowed };
  return mcpToolsFor(hasFiles === undefined ? input : { ...input, hasFiles })
    .map((t) => t.name)
    .slice(0, MCP_TOOLS_MAX);
}

/** CR-054 · tên agent + model của bước (đổi C1-R04: hiện tên hiển thị, không lộ provider/workflow). */
const stepAgent = (task: AgentTask, model: string | null) => ({
  key: task.agent.key,
  name: task.agent.name[task.run.locale],
  model,
});

export class JobAgentRunner implements AgentRunner {
  readonly #follower: JobFollower;

  constructor(private readonly d: JobAgentRunnerDeps) {
    this.#follower = new JobFollower(d);
  }

  #system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "system" }, fn);
  }

  /**
   * `payload.mcp` (P4: không token). Chỉ agent (không Orchestrator); catalog lỗi → không tool workflow + cảnh báo. K1 §3.4
   * bước 0: khoá catalog gộp `kh-query` TRƯỚC `mcpConfigFor` (catalog rỗng vẫn dựng config khi có KH); quá trần ⇒ bỏ KH.
   */
  async #mcp(task: AgentTask): Promise<JobMcp> {
    const m = this.d.mcp;
    if (!m || task.role !== "agent") return NO_MCP;
    const [keys, kh] = await Promise.all([this.#catalogKeys(task, m), this.#kh(task)]);
    let khItems = kh;
    if (khItems.length > 0 && !keys.includes(KH_TOOL_KEY)) {
      if (keys.length < MCP_TOOLS_MAX) keys.push(KH_TOOL_KEY);
      else {
        this.d.log.warn("kh-tool-dropped", { run_id: task.run.id, reason: "mcp_tools_max" });
        khItems = [];
      }
    }
    const mcp = mcpConfigFor(task.agent, keys, m.url);
    return { mcp, khItems: mcp ? khItems : [] };
  }

  async #catalogKeys(
    task: AgentTask,
    m: NonNullable<JobAgentRunnerDeps["mcp"]>,
  ): Promise<string[]> {
    const ids = agentWorkflowIds(task.snapshot, task.agent.id);
    if (ids.size === 0) return [];
    try {
      return agentToolKeys(ids, await m.catalog(), agentFiles(task).length > 0);
    } catch (err) {
      this.d.log.warn("job-mcp-unavailable", { run_id: task.run.id, ...safeErrorFields(err) });
      return [];
    }
  }

  #kh(task: AgentTask): Promise<KhJobItem[]> {
    if (!this.d.kh || !task.stageRunId) return Promise.resolve([]);
    const i = { agentId: task.agent.id, runtime: task.agent.runtime, stageJob: true };
    return this.d.kh({ ...i, runId: task.run.id });
  }

  /**
   * H4b-2 plan §3.4 · bước profile cho job (`pickStep`; agent có `model` riêng ⇒ chỉ bước 0, Q4). Vắng profile ⇒ null
   * (payload sai). Có bước bị bỏ ⇒ `job.fallback` (chỉ key/lý do, không dữ liệu nhạy cảm).
   */
  async #pickStep(task: AgentTask): Promise<JobStep | null> {
    const profile = task.snapshot.profiles.find((p) => p.id === task.agent.profileId);
    if (!profile) return null;
    const keys = stepProviderKeys(profile);
    const states = await this.#system((tx) => repo.providerStatesOf(tx, keys));
    const opts = { now: new Date(), agentHasOwnModel: task.agent.model != null };
    const r = chooseJobStep(profile, task.snapshot.providers, states, opts);
    if (r.ok && r.skipped.length > 0) {
      const to = r.profile.steps[0]?.provider_key;
      this.d.log.info("job.fallback", { run_id: task.run.id, skipped: r.skipped, to });
    }
    return r;
  }

  #payload(
    task: AgentTask,
    profile: ProfileConfig,
    ids: { jobId: string; stepId: string },
    { mcp, khItems }: JobMcp,
  ): AgentCliJob | null {
    const attachments = jobAttachments(agentFiles(task));
    const block = agentFilesBlock(attachments);
    // K1 D10 · có `kh-query` ⇒ dòng gợi ý cuối prompt nhiệm vụ.
    const prompt = khItems.length > 0 ? `${task.prompt}\n\n${KH_QUERY_HINT}` : task.prompt;
    const payload = buildJobPayload({
      jobId: ids.jobId,
      stepId: ids.stepId,
      mcp,
      run: task.run,
      agent: task.agent,
      role: task.role,
      profile,
      prompt: block ? `${prompt}\n\n${block}` : prompt,
      systemPrompt: task.systemPrompt ?? task.agent.systemPrompt,
      history: task.history,
      stream: task.stream !== undefined,
      attachments,
      ...(task.role === "agent" && task.sources?.length ? { sources: task.sources } : {}),
      ...(task.useSession === false ? { useSession: false } : {}),
    });
    return payload && this.#outHint(task, payload);
  }

  /** P10, PL9 · job có `Write` (chỉ agent `agent.cli` cấu hình) → `system_prompt` + `OUT_HINT`; chạm trần → giữ + `warn`. */
  #outHint(task: AgentTask, payload: AgentCliJob): AgentCliJob {
    if (!payload.allowed_tools.includes("Write")) return payload;
    const hint = withOutHint(payload.system_prompt, SYSTEM_PROMPT_MAX);
    if (hint.dropped) {
      const f = { run_id: task.run.id, agent_id: task.agent.id };
      this.d.log.warn("attachment-out-hint-dropped", f);
    }
    return { ...payload, system_prompt: hint.text };
  }

  async *run(task: AgentTask, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const jobId = crypto.randomUUID();
    const stepId = task.stepId ?? crypto.randomUUID();
    const jm = await this.#mcp(task);
    const pick = await this.#pickStep(task);
    if (pick && !pick.ok) {
      const f = { code: "ALL_PROVIDERS_EXHAUSTED", reason: pick.reason } as const;
      yield syntheticFailed(jobId, { ...f, message: `no usable profile step: ${pick.reason}` });
      return;
    }
    const payload = pick && this.#payload(task, pick.profile, { jobId, stepId }, jm);
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
    const queue = new EventQueue();
    const unsub = await this.d.reader.subscribe(task.run.id, (e) => {
      if (e.job_id === jobId) queue.push(e);
    });
    try {
      const type = stepType(task.role);
      // Huỷ/mất lease → không INSERT job (job mồ côi giữ slot tới timeout); `runJob` quy về `aborted`.
      const seq = await this.#enqueue(task, { payload, khItems: jm.khItems }, stepId, signal);
      if (typeof seq !== "number")
        return this.d.log.info("job-enqueue-skipped", { run_id: task.run.id, reason: seq });
      const label = stepLabel(type, task.run.locale);
      const data = { step_id: `s${seq}`, label, agent: stepAgent(task, payload.model) };
      await emitStep(task, { event: "step.started", data }, this.d.log);
      yield* this.#follower.follow(
        { task, jobId, stepId, seq, providerKey: payload.provider_key },
        queue,
        signal,
      );
    } finally {
      unsub();
    }
  }

  /** `seq` của step khi đã vào hàng đợi (P11: DB cấp); không thì lý do bỏ qua INSERT job. */
  async #enqueue(
    task: AgentTask,
    j: { payload: AgentCliJob; khItems: readonly KhJobItem[] },
    stepId: string,
    signal: AbortSignal,
  ): Promise<number | "aborted" | "not_enqueued"> {
    if (signal.aborted) return "aborted";
    const step = stepInsert(task, stepId, this.d.owner);
    const seq = await this.#system((tx) => repo.enqueueJob(tx, j.payload, step, j.khItems));
    return seq ?? "not_enqueued";
  }
}

/**
 * Chạy một job tới kết thúc và quy về kết quả cho vòng Orchestrator (B8). Lỗi job → mã run (P11, không mang `message`
 * gốc); lỗi bất ngờ (DB/Redis) → `INTERNAL_ERROR`. H2b P11: sự kiện không kết thúc của job → `task.stream` (delta).
 */
export async function runJob(
  runner: AgentRunner,
  task: AgentTask,
  signal: AbortSignal,
  log: Logger,
): Promise<JobOutcome> {
  const t = task.stepId ? task : { ...task, stepId: crypto.randomUUID() };
  const streamed = (): JobStreamed => ({
    streamed: t.stream?.text ?? "",
    gap: t.stream?.gap ?? null,
    stepId: t.stepId ?? "",
  });
  try {
    for await (const ev of runner.run(t, signal)) {
      if (ev.type === "job.result") {
        const { output, usage } = ev;
        return {
          kind: "result",
          jobId: ev.job_id,
          output,
          usage,
          ...(ev.source_reads ? { sourceReads: ev.source_reads } : {}),
          ...streamed(),
        };
      }
      if (ev.type === "job.failed") {
        const f = { code: runErrorCodeOf(ev.code), reason: ev.reason, usage: ev.usage };
        return { kind: "failed", jobId: ev.job_id, ...f, ...streamed() };
      }
      await t.stream?.onEvent(ev);
    }
  } catch (err) {
    if (signal.aborted) return { kind: "aborted" };
    log.error("job-run-failed", { run_id: task.run.id, ...safeErrorFields(err) });
    const f = { code: "INTERNAL_ERROR", reason: null, usage: ZERO_USAGE } as const;
    return { kind: "failed", jobId: "", ...f, ...streamed() };
  }
  return { kind: "aborted" };
}
