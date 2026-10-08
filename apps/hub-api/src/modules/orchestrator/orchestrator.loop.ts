// HUB-FR-20 · HUB-FR-21 · HUB-FR-27 · HUB-FR-28 · HUB-FR-29 · CR-025 · vòng Orchestrator (plan H1 §6.1): mọi tin → job
// Orchestrator → delegate|answer|ask; delegate → kiểm quyền (HUB-BR-03) → job agent → done|partial|need_input.
// I/O tiêm qua `LoopIo` (job, step skipped) để test không cần DB/Redis.
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type {
  AgentResult,
  HistoryItem,
  JobFailReason,
  JobOutput,
  OrchestratorDecision,
  TokenUsage,
} from "@ai/contracts/hub";
import {
  canDelegate,
  type HubAgentRef,
  type VisibleAgentsInput,
} from "../agents/agent-access.rules";
import type { NoMatchPolicy } from "../agents/default-agent.rules";
import type { FileBrief } from "../attachments/run-files.rules";
import type { AgentConfig } from "../config/config.rules";
import type { AgentRole } from "../runner/runner.rules";
import {
  type DeltaKind,
  type Reconciled,
  reconcileStream,
  streamAccept,
} from "../stream/delta.rules";
import {
  type FlowHint,
  orchestratorPrompt,
  orchestratorSystemPrompt,
  type StepNote,
} from "./orchestrator.prompt";
import { budgetExceeded, budgetOutcome, canPassThrough, parseDecision } from "./orchestrator.rules";

/** H2b P11 · phần đã phát (S) của job và step của nó; vắng = không stream. */
type LoopStreamed = { streamed?: string; stepId?: string };

/** Kết quả một job, cùng dạng `JobOutcome` của runner (B7). */
export type LoopJobOutcome =
  | ({ kind: "result"; output: JobOutput; usage: TokenUsage } & LoopStreamed)
  | ({
      kind: "failed";
      code: ChatRunErrorCode;
      usage: TokenUsage;
      reason?: JobFailReason | null;
    } & LoopStreamed)
  | { kind: "aborted" };

export type LoopJob = {
  agent: AgentConfig;
  role: AgentRole;
  prompt: string;
  systemPrompt?: string;
  history: readonly HistoryItem[];
  stepId?: string;
  reopen?: boolean;
  /** H2b P13 · gộp vào `run_steps.detail` của step (vd `scope` của run thu hẹp, R09). */
  detail?: Readonly<Record<string, unknown>>;
  /** H2b P11 · loại delta chuyển tiếp (`streamAccept`); vắng = job không stream. */
  stream?: readonly DeltaKind[];
};

export type LoopIo = {
  job(j: LoopJob): Promise<LoopJobOutcome>;
  /** Step `skipped` (H1-R06); `seq` do DB cấp (P11). */
  skip(s: { agentId: string | null; agentKey: string }): Promise<void>;
};

export type LoopInput = {
  /** CR-054 · chính sách "không khớp" (tin không tag → Orchestrator mặc định); vắng = `answer`. */
  noMatch?: NoMatchPolicy;
  orchestrator: AgentConfig;
  agents: readonly AgentConfig[];
  settings: { maxSteps: number; tokenBudget: number };
  access: VisibleAgentsInput;
  visible: readonly HubAgentRef[];
  hint: FlowHint;
  history: readonly HistoryItem[];
  message: string;
  locale: "vi" | "en";
  /** H2b P13 · `detail` cho mọi step Orchestrator (run thu hẹp: `{scope}`). */
  stepDetail?: Readonly<Record<string, unknown>>;
  /** H2c P11 · tập file của run (R15) cho khối `<attachments>` của prompt Orchestrator; vắng/rỗng = như H1. */
  attachments?: readonly FileBrief[];
  /** H2b P11 · run được stream (Orchestrator + delegate đầu, plan §5.5); vắng = như H1. */
  stream?: boolean;
};

export type Ask = { question: string; choices: string[] };

/** H2b P12 · kết thúc của job đã phát: `text` (nội dung) bắt đầu bằng `streamed`; `trace` R23 cho step `stepId`. */
export type LoopStreamEnd = {
  streamed: string;
  stepId: string;
  trace: Reconciled["trace"];
  finalLen: number;
};

/** `agentId` vắng = giữ `flows.agent_id`. */
export type LoopEnd =
  | { kind: "text"; text: string; agentId?: string; stream?: LoopStreamEnd }
  | { kind: "ask"; ask: Ask; agentId?: string }
  | { kind: "failed"; code: ChatRunErrorCode; reason?: JobFailReason }
  | { kind: "aborted" };

type Stop = Extract<LoopEnd, { kind: "failed" | "aborted" }>;

type State = {
  steps: number;
  tokens: number;
  delegates: number;
  hadPartial: boolean;
  answered: string | null;
  notes: StepNote[];
};

const addUsage = (s: State, o: LoopJobOutcome) => {
  if (o.kind !== "aborted") s.tokens += o.usage.input_tokens + o.usage.output_tokens;
};

/** Job lỗi → run lỗi cùng mã (P11) + `reason` (P15, vd `refused` ⇒ hint F4; khoá vắng khi null); huỷ → dừng. */
function stopOf(o: Exclude<LoopJobOutcome, { kind: "result" }>): Stop {
  if (o.kind === "aborted") return o;
  return o.reason
    ? { kind: "failed", code: o.code, reason: o.reason }
    : { kind: "failed", code: o.code };
}

/** P12 · đã phát rồi `invalid_output` (JSON cuối hỏng) → kết thúc với S (`stream_unparsed`); lỗi khác → null (như H1). */
function stoppedAfterStream(
  o: Exclude<LoopJobOutcome, { kind: "result" }>,
  agentId?: string,
): LoopEnd | null {
  if (o.kind !== "failed" || !streamedOf(o) || o.reason !== "invalid_output") return null;
  return streamEnd(o, null, agentId);
}

type StreamJob = Parameters<typeof streamAccept>[0];

/** P11 · `stream` của job theo bảng §5.5 khi run được stream; `[]` → không khoá. */
function acceptOf(c: LoopInput, j: StreamJob): { stream?: readonly DeltaKind[] } {
  const accept = c.stream ? streamAccept(j) : [];
  return accept.length > 0 ? { stream: accept } : {};
}

function budgetEnd(s: State, locale: "vi" | "en"): LoopEnd {
  const o = budgetOutcome(s.answered, locale);
  return o.kind === "fail" ? { kind: "failed", code: o.code } : { kind: "text", text: o.text };
}

/** S của job (rỗng nếu không stream). */
const streamedOf = (o: LoopJobOutcome): string => (o.kind === "aborted" ? "" : (o.streamed ?? ""));

/** P12 · job đã phát S: kết thúc với `reconcileStream(S, F)` (F null = kết quả cuối hỏng); không rút lại chữ đã gửi. */
function streamEnd(
  o: Exclude<LoopJobOutcome, { kind: "aborted" }>,
  final: string | null,
  agentId?: string,
): LoopEnd {
  const streamed = o.streamed ?? "";
  const r = reconcileStream(streamed, final);
  const stream = { streamed, stepId: o.stepId ?? "", trace: r.trace, finalLen: final?.length ?? 0 };
  return { kind: "text", text: r.content, ...(agentId ? { agentId } : {}), stream };
}

type Decided =
  | { kind: "decision"; decision: OrchestratorDecision }
  | { kind: "end"; end: LoopEnd }
  | Stop;

/** P12 · Orchestrator đã phát: không thử lại; `answer` → F = `text`; quyết định khác (không thể xảy ra) → lệch. */
function streamedDecision(
  o: Extract<LoopJobOutcome, { kind: "result" }>,
  d: ReturnType<typeof parseDecision> | null,
): Decided {
  if (!d?.ok) return { kind: "end", end: streamEnd(o, null) };
  const final = d.decision.decision === "answer" ? d.decision.text : "";
  return { kind: "end", end: streamEnd(o, final) };
}

/**
 * Một step Orchestrator; JSON hỏng → thử lại 1 lần cùng step kèm câu nhắc; vẫn hỏng → `UPSTREAM_ERROR` (H1-R06). H2b
 * P11–P12: run stream → job `stream=["answer"]`; đã phát thì không thử lại (R21).
 */
async function decide(io: LoopIo, c: LoopInput, s: State): Promise<Decided> {
  const prompt = (retry: boolean) =>
    orchestratorPrompt(
      {
        agents: c.visible,
        hint: c.hint,
        history: c.history,
        steps: s.notes,
        stepsLeft: c.settings.maxSteps - s.steps,
        message: c.message,
        ...(c.attachments?.length ? { attachments: c.attachments } : {}),
      },
      retry,
    );
  const base = {
    agent: c.orchestrator,
    role: "orchestrator" as const,
    systemPrompt: orchestratorSystemPrompt(c.orchestrator.systemPrompt, c.noMatch),
    history: [],
    stepId: crypto.randomUUID(),
    ...(c.stepDetail ? { detail: c.stepDetail } : {}),
    ...acceptOf(c, { role: "orchestrator", runKind: "orchestrated", firstDelegate: false }),
  };
  const first = prompt(false);
  s.steps++;
  for (const retry of [false, true]) {
    const o = await io.job({ ...base, prompt: retry ? prompt(true) : first, reopen: retry });
    addUsage(s, o);
    if (o.kind !== "result") {
      const end = stoppedAfterStream(o);
      return end ? { kind: "end", end } : stopOf(o);
    }
    const d = o.output.kind === "text" ? parseDecision(o.output.text) : null;
    if (streamedOf(o)) return streamedDecision(o, d);
    if (d?.ok) return { kind: "decision", decision: d.decision };
  }
  return { kind: "failed", code: "UPSTREAM_ERROR" };
}

/**
 * Một step delegate; null = đưa kết quả vào `<steps>` rồi quay lại Orchestrator. H2b P11: delegate đầu của run stream →
 * `stream=["done"]`; đã phát ≥ 1 delta ⇒ kết thúc pass-through bất kể `status` (khác `done` ⇒ S + `delta_mismatch`).
 */
async function delegate(
  io: LoopIo,
  c: LoopInput,
  s: State,
  d: { agent: AgentConfig; task: string },
): Promise<LoopEnd | null> {
  const firstDelegate = s.delegates === 0;
  s.steps++;
  s.delegates++;
  const o = await io.job({
    agent: d.agent,
    role: "agent",
    prompt: d.task,
    history: c.history,
    ...acceptOf(c, { role: "agent", runKind: "orchestrated", firstDelegate }),
  });
  addUsage(s, o);
  if (o.kind !== "result") return stoppedAfterStream(o, d.agent.id) ?? stopOf(o);
  const r = o.output.kind === "agent_result" ? o.output.result : null;
  if (streamedOf(o)) return streamEnd(o, r?.status === "done" ? r.text : "", d.agent.id);
  if (!r) return { kind: "failed", code: "UPSTREAM_ERROR" };
  return afterAgent(s, d.agent, r);
}

function afterAgent(s: State, agent: AgentConfig, r: AgentResult): LoopEnd | null {
  if (canPassThrough(s, r) && r.status === "done")
    return { kind: "text", text: r.text, agentId: agent.id };
  if (r.status === "need_input")
    return { kind: "ask", ask: { question: r.question, choices: r.choices }, agentId: agent.id };
  if (r.status === "partial") {
    s.hadPartial = true;
    s.notes.push({ agent: agent.key, status: "partial", text: r.text, missing: r.missing });
  } else {
    s.notes.push({ agent: agent.key, status: "done", text: r.text });
  }
  s.answered = r.text;
  return null;
}

type Delegate = Extract<OrchestratorDecision, { decision: "delegate" }>;

/** Delegate: hết `max_steps` → dừng; ngoài quyền (kiểm lại mỗi lần, HUB-BR-03) → step `skipped`; còn lại chạy agent. */
async function onDelegate(
  io: LoopIo,
  c: LoopInput,
  s: State,
  dec: Delegate,
): Promise<LoopEnd | null> {
  if (s.steps >= c.settings.maxSteps) return budgetEnd(s, c.locale);
  const ref = canDelegate(c.access, dec.agent);
  const agent = ref ? c.agents.find((a) => a.id === ref.id) : undefined;
  if (agent) return delegate(io, c, s, { agent, task: dec.task });
  const known = c.agents.find((a) => a.key === dec.agent);
  await io.skip({ agentId: known?.id ?? null, agentKey: dec.agent });
  s.steps++;
  s.notes.push({ agent: dec.agent, status: "skipped", reason: "not_allowed" });
  return null;
}

/**
 * plan §6.1. `max_steps` chặn mọi step; `token_budget` kiểm trước mỗi lần gọi Orchestrator (quyết định delegate đã có
 * vẫn chạy — AC A23). Delegate ngoài quyền → step `skipped`, tính vào `max_steps`.
 */
export async function runLoop(io: LoopIo, c: LoopInput): Promise<LoopEnd> {
  const s: State = {
    steps: 0,
    tokens: 0,
    delegates: 0,
    hadPartial: false,
    answered: null,
    notes: [],
  };
  const { maxSteps, tokenBudget } = c.settings;
  for (;;) {
    if (budgetExceeded({ steps: s.steps, maxSteps, tokens: s.tokens, tokenBudget }))
      return budgetEnd(s, c.locale);
    const d = await decide(io, c, s);
    if (d.kind === "end") return d.end;
    if (d.kind !== "decision") return d;
    const dec = d.decision;
    if (dec.decision === "answer") return { kind: "text", text: dec.text };
    if (dec.decision === "ask")
      return { kind: "ask", ask: { question: dec.question, choices: dec.choices } };
    const end = await onDelegate(io, c, s, dec);
    if (end) return end;
  }
}
