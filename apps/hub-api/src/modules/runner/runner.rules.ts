// HUB-FR-89 · HUB-BR-03 · H1-R18, R21 · luật thuần AgentRunner (plan H1 §2.2, §2.3, §5.6, P11): dựng `JobPayload`,
// provider dùng được không, dựng sự kiện job từ dòng `hub.jobs` (P7), mã lỗi job → mã lỗi run.
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import {
  type AgentCliJob,
  AgentCliJobSchema,
  ALLOWED_TOOLS,
  type AllowedTool,
  FALLBACK_TRIGGERS,
  type HistoryItem,
  HUB_CONTRACT_VERSION,
  HUB_JOB_ERROR_CODES,
  type HubJobErrorCode,
  JOB_FAIL_REASONS,
  type JobFailReason,
  JobOutputSchema,
  type McpConfig,
  type RunEvent,
  type TokenUsage,
  type WorkflowAsyncJob,
} from "@ai/contracts/hub";
import type { WorkflowJobInput } from "../commands/catalog.types";
import type { AgentConfig, ProfileConfig } from "../config/config.rules";

export type AgentRole = "orchestrator" | "agent";
/** Hub điền khi `runtime_options.max_turns` vắng (plan §2.2). */
export const DEFAULT_MAX_TURNS: Record<AgentRole, number> = { agent: 30, orchestrator: 3 };
/** H1-R21: agent mặc định chỉ đọc + tìm. */
export const DEFAULT_AGENT_TOOLS: readonly AllowedTool[] = ["Read", "Grep"];
export const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 };

export type RunRef = {
  id: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
};

export type PayloadInput = {
  jobId: string;
  stepId: string;
  run: RunRef;
  agent: AgentConfig;
  role: AgentRole;
  profile: ProfileConfig;
  prompt: string;
  systemPrompt: string;
  history: readonly HistoryItem[];
};

/** Agent kẹp ≥ 2: structured output tốn một lượt (Runtime đã tự ép, Hub khớp). */
export const AGENT_MIN_TURNS = 2;

export function maxTurns(opts: Record<string, unknown>, role: AgentRole): number {
  const v = opts.max_turns;
  const n = typeof v === "number" && Number.isInteger(v) ? v : DEFAULT_MAX_TURNS[role];
  return role === "agent" ? Math.max(n, AGENT_MIN_TURNS) : n;
}

/** Agent: `runtime_options.allowed_tools` ∩ {Read, Grep, Glob} (vắng → Read, Grep); Orchestrator: không tool. */
function allowedTools(opts: Record<string, unknown>, role: AgentRole): AllowedTool[] {
  if (role === "orchestrator") return [];
  const v = opts.allowed_tools;
  if (!Array.isArray(v)) return [...DEFAULT_AGENT_TOOLS];
  return ALLOWED_TOOLS.filter((t) => v.includes(t));
}

const isTrigger = (s: string): s is (typeof FALLBACK_TRIGGERS)[number] =>
  (FALLBACK_TRIGGERS as readonly string[]).includes(s);

/**
 * `JobPayload` (plan §2.2) đã qua `JobPayloadSchema` — sai contract (vd `timeout_s` ngoài 10–3600) → null.
 * H1 chỉ chạy bước 0 của profile (H1-R18).
 */
export function buildJobPayload(i: PayloadInput): AgentCliJob | null {
  const step = i.profile.steps[0];
  // H1 chỉ có job `agent.cli` (runtime `agentic-cli`); runtime khác → không dựng payload sai loại.
  if (!step || i.agent.runtime !== "agentic-cli") return null;
  const opts = i.agent.runtimeOptions;
  const isAgent = i.role === "agent";
  const parsed = AgentCliJobSchema.safeParse({
    v: HUB_CONTRACT_VERSION,
    type: "agent.cli",
    runtime: "agentic-cli",
    job_id: i.jobId,
    run_id: i.run.id,
    step_id: i.stepId,
    tenant_id: i.run.tenantId,
    user_id: i.run.userId,
    conversation_id: i.run.conversationId,
    flow_id: i.run.flowId,
    feature_id: null,
    agent_type_key: null,
    mcp: null,
    agent: { id: i.agent.id, key: i.agent.key, role: i.role },
    provider_key: step.provider_key,
    model: step.model,
    step_index: 0,
    max_turns: maxTurns(opts, i.role),
    profile_steps: [
      { provider_key: step.provider_key, model: step.model, on: step.on.filter(isTrigger) },
    ],
    system_prompt: i.systemPrompt,
    prompt: i.prompt,
    history: [...i.history],
    use_session: isAgent,
    allowed_tools: allowedTools(opts, i.role),
    output: isAgent ? "agent_result" : "text",
    timeout_s: i.agent.timeoutS,
  });
  return parsed.success ? parsed.data : null;
}

/** H1-R18: cooldown chưa hết (hoặc không có giờ hết) / `logged_out` / `error` → không tạo job. Khớp điều kiện claim. */
export function providerBlocked(
  s: { status: string; cooldownUntil: Date | null } | undefined,
  now: Date,
): boolean {
  if (!s) return false;
  if (s.status === "logged_out" || s.status === "error") return true;
  if (s.status === "cooldown") return !s.cooldownUntil || s.cooldownUntil.getTime() > now.getTime();
  return false;
}

export const isJobTerminal = (e: RunEvent): boolean =>
  e.type === "job.result" || e.type === "job.failed";

/** `HubJobErrorCode` ⊂ `ChatRunErrorCode` (plan §2.5): run lỗi cùng mã; `message` gốc của Runtime không ra client (P11). */
export function runErrorCodeOf(code: HubJobErrorCode): ChatRunErrorCode {
  return code;
}

const FAILED_STATUSES = ["failed", "cancelled", "timed_out"] as const;
type FailedStatus = (typeof FAILED_STATUSES)[number];
/** Mã mặc định theo trạng thái khi `error_code` vắng/lạ. */
const STATUS_CODE: Record<FailedStatus, HubJobErrorCode> = {
  failed: "INTERNAL_ERROR",
  cancelled: "CANCELLED",
  timed_out: "TIMEOUT",
};

/** Sự kiện Hub tự dựng (không có trong `run:<id>`): `seq` 1, `at` = bây giờ. */
export type JobFailedEvent = Extract<RunEvent, { type: "job.failed" }>;

export function syntheticFailed(
  jobId: string,
  f: {
    code: HubJobErrorCode;
    reason: JobFailReason | null;
    message: string;
    status?: FailedStatus;
  },
  now = new Date(),
): JobFailedEvent {
  return {
    v: HUB_CONTRACT_VERSION,
    job_id: jobId,
    seq: 1,
    at: now.toISOString(),
    type: "job.failed",
    status: f.status ?? "failed",
    code: f.code,
    reason: f.reason,
    message: f.message.slice(0, 500) || f.code,
    usage: ZERO_USAGE,
  };
}

export type JobRow = {
  status: string;
  result: unknown;
  errorCode: string | null;
  errorReason: string | null;
  errorMessage: string | null;
};

/**
 * P7 · job đã kết thúc trong DB mà chưa thấy sự kiện → dựng `job.result`/`job.failed` (dạng `jobs.result` = `JobOutput`).
 * Còn `queued`/`running` → null. `result` sai `JobOutput` → `job.failed UPSTREAM_ERROR invalid_output`.
 */
export function eventFromJobRow(
  jobId: string,
  row: JobRow,
  usage: TokenUsage,
  now = new Date(),
): RunEvent | null {
  const at = now.toISOString();
  if (row.status === "succeeded") {
    const out = JobOutputSchema.safeParse(row.result);
    if (!out.success) {
      const f = {
        code: "UPSTREAM_ERROR",
        reason: "invalid_output",
        message: "invalid result",
      } as const;
      return { ...syntheticFailed(jobId, f, now), usage };
    }
    const base = { v: HUB_CONTRACT_VERSION, job_id: jobId, seq: 1, at } as const;
    return { ...base, type: "job.result", output: out.data, usage, session_resumed: false };
  }
  const status = FAILED_STATUSES.find((s) => s === row.status);
  if (!status) return null;
  const code = (HUB_JOB_ERROR_CODES as readonly string[]).includes(row.errorCode ?? "")
    ? (row.errorCode as HubJobErrorCode)
    : STATUS_CODE[status];
  const reason = (JOB_FAIL_REASONS as readonly string[]).includes(row.errorReason ?? "")
    ? (row.errorReason as JobFailReason)
    : null;
  const message = row.errorMessage ?? `job ${status}`;
  return { ...syntheticFailed(jobId, { code, reason, message, status }, now), usage };
}

/** So id entry Redis Stream `<ms>-<seq>`. */
export function compareStreamId(a: string, b: string): number {
  const [am = 0n, as = 0n] = a.split("-").map((x) => BigInt(x));
  const [bm = 0n, bs = 0n] = b.split("-").map((x) => BigInt(x));
  if (am !== bm) return am < bm ? -1 : 1;
  if (as !== bs) return as < bs ? -1 : 1;
  return 0;
}

// HUB-FR-89, HUB-FR-50 · H2a-R13, R18, P10 · job `workflow.async`, cấu hình MCP, requeue orphan (plan-rules).
// B0: chỉ chữ ký — thân làm ở B6/B8.

export type OrphanJob = {
  type: "agent.cli" | "workflow.async";
  attempts: number;
  sideEffect: boolean;
  dispatched: boolean;
};

/** Kết quả parse `WorkflowAsyncJobSchema`; không khoá secret/URL; `side_effect` theo cờ workflow. */
export function buildWorkflowJobPayload(i: WorkflowJobInput): WorkflowAsyncJob {
  throw new Error(`not implemented: buildWorkflowJobPayload(${i.jobId})`);
}

/** `toolKeys` rỗng → `null`; có → `{url, tools}` (token không ở đây, P4). */
export function mcpConfigFor(
  agent: AgentConfig,
  toolKeys: readonly string[],
  url: string,
): McpConfig | null {
  throw new Error(`not implemented: mcpConfigFor(${agent.key}, ${toolKeys.length}, ${url.length})`);
}

/** R13/P10: `workflow.async` ∧ `attempts < 3` ∧ ¬(`sideEffect` ∧ `dispatched`) → requeue; còn lại → fail. */
export function orphanAction(j: OrphanJob): "requeue" | "fail" {
  throw new Error(`not implemented: orphanAction(${j.type}, ${j.attempts})`);
}
