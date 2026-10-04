// HUB-FR-20 · HUB-FR-21 · HUB-FR-27 · HUB-FR-28 · HUB-FR-29 · CR-025 · vòng Orchestrator (plan H1 §6.1): mọi tin → job
// Orchestrator → delegate|answer|ask; delegate → kiểm quyền (HUB-BR-03) → job agent → done|partial|need_input.
// I/O tiêm qua `LoopIo` (job, step skipped) để test không cần DB/Redis.
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type {
  AgentResult,
  HistoryItem,
  JobOutput,
  OrchestratorDecision,
  TokenUsage,
} from "@ai/contracts/hub";
import {
  canDelegate,
  type HubAgentRef,
  type VisibleAgentsInput,
} from "../agents/agent-access.rules";
import type { AgentConfig } from "../config/config.rules";
import type { AgentRole } from "../runner/runner.rules";
import {
  type FlowHint,
  orchestratorPrompt,
  orchestratorSystemPrompt,
  type StepNote,
} from "./orchestrator.prompt";
import { budgetExceeded, budgetOutcome, canPassThrough, parseDecision } from "./orchestrator.rules";

/** Kết quả một job, cùng dạng `JobOutcome` của runner (B7). */
export type LoopJobOutcome =
  | { kind: "result"; output: JobOutput; usage: TokenUsage }
  | { kind: "failed"; code: ChatRunErrorCode; usage: TokenUsage }
  | { kind: "aborted" };

export type LoopJob = {
  agent: AgentConfig;
  role: AgentRole;
  prompt: string;
  systemPrompt?: string;
  history: readonly HistoryItem[];
  seq: number;
  stepId?: string;
  reopen?: boolean;
};

export type LoopIo = {
  job(j: LoopJob): Promise<LoopJobOutcome>;
  skip(s: { seq: number; agentId: string | null; agentKey: string }): Promise<void>;
};

export type LoopInput = {
  orchestrator: AgentConfig;
  agents: readonly AgentConfig[];
  settings: { maxSteps: number; tokenBudget: number };
  access: VisibleAgentsInput;
  visible: readonly HubAgentRef[];
  hint: FlowHint;
  history: readonly HistoryItem[];
  message: string;
  locale: "vi" | "en";
};

export type Ask = { question: string; choices: string[] };
/** `agentId` vắng = giữ `flows.agent_id`. */
export type LoopEnd =
  | { kind: "text"; text: string; agentId?: string }
  | { kind: "ask"; ask: Ask; agentId?: string }
  | { kind: "failed"; code: ChatRunErrorCode }
  | { kind: "aborted" };

type Stop = Extract<LoopEnd, { kind: "failed" | "aborted" }>;

type State = {
  seq: number;
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

/** Job lỗi → run lỗi cùng mã (P11); huỷ → dừng. */
const stopOf = (o: Exclude<LoopJobOutcome, { kind: "result" }>): Stop =>
  o.kind === "failed" ? { kind: "failed", code: o.code } : { kind: "aborted" };

function budgetEnd(s: State, locale: "vi" | "en"): LoopEnd {
  const o = budgetOutcome(s.answered, locale);
  return o.kind === "fail" ? { kind: "failed", code: o.code } : { kind: "text", text: o.text };
}

type Decided = { kind: "decision"; decision: OrchestratorDecision } | Stop;

/** Một step Orchestrator; JSON hỏng → thử lại 1 lần cùng step kèm câu nhắc; vẫn hỏng → `UPSTREAM_ERROR` (H1-R06). */
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
      },
      retry,
    );
  const base = {
    agent: c.orchestrator,
    role: "orchestrator" as const,
    systemPrompt: orchestratorSystemPrompt(c.orchestrator.systemPrompt),
    history: [],
    seq: ++s.seq,
    stepId: crypto.randomUUID(),
  };
  const first = prompt(false);
  s.steps++;
  for (const retry of [false, true]) {
    const o = await io.job({ ...base, prompt: retry ? prompt(true) : first, reopen: retry });
    addUsage(s, o);
    if (o.kind !== "result") return stopOf(o);
    const d = o.output.kind === "text" ? parseDecision(o.output.text) : null;
    if (d?.ok) return { kind: "decision", decision: d.decision };
  }
  return { kind: "failed", code: "UPSTREAM_ERROR" };
}

/** Một step delegate; null = đưa kết quả vào `<steps>` rồi quay lại Orchestrator. */
async function delegate(
  io: LoopIo,
  c: LoopInput,
  s: State,
  d: { agent: AgentConfig; task: string },
): Promise<LoopEnd | null> {
  s.steps++;
  s.delegates++;
  const o = await io.job({
    agent: d.agent,
    role: "agent",
    prompt: d.task,
    history: c.history,
    seq: ++s.seq,
  });
  addUsage(s, o);
  if (o.kind !== "result") return stopOf(o);
  if (o.output.kind !== "agent_result") return { kind: "failed", code: "UPSTREAM_ERROR" };
  return afterAgent(s, d.agent, o.output.result);
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
  await io.skip({ seq: ++s.seq, agentId: known?.id ?? null, agentKey: dec.agent });
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
    seq: 0,
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
    if (d.kind !== "decision") return d;
    const dec = d.decision;
    if (dec.decision === "answer") return { kind: "text", text: dec.text };
    if (dec.decision === "ask")
      return { kind: "ask", ask: { question: dec.question, choices: dec.choices } };
    const end = await onDelegate(io, c, s, dec);
    if (end) return end;
  }
}
