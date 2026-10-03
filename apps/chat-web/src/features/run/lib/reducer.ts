// UC-02, UC-04, UC-06, UC-08, CHAT-AC-06 · reducer thuần của một run: phase + chữ + bước + ask/lỗi/quota.
// `run.finished.content` THAY chữ đã ghép (nguồn đúng duy nhất); sự kiện `id ≤ lastEventId` bị bỏ (chống lặp khi nối lại).
import {
  type Ask,
  type ChatEvent,
  isFlowIdle,
  isNewEvent,
  type RunError,
  type RunStartedData,
} from "@ai/contracts/chat";

export type RunPhase =
  | "sending"
  | "cold"
  | "streaming"
  | "reconnecting"
  | "finished"
  | "asked"
  | "failed"
  | "cancelled"
  | "lost";
export type RunOrigin = "main" | "flow";
export type RunStep = {
  id: string;
  label: string;
  status: "running" | "ok" | "failed";
  ms: number | null;
};
export type RunRequest = { content: string; flowId?: string };

export type RunState = {
  /** Khoá cục bộ (có trước `runId`, vì `runId` chỉ biết khi E12 trả header). */
  key: string;
  convId: string;
  runId: string | null;
  flowId: string | null;
  /** Tin user (`X-Message-Id`). */
  messageId: string | null;
  /** Tin trả lời (`run.finished`/`run.failed`.`message_id`) — để biết khi query đã chứa nó. */
  answerId: string | null;
  origin: RunOrigin;
  request: RunRequest;
  phase: RunPhase;
  /** Flow nghỉ lúc gửi → hiện "Đang mở lại flow…" tới `run.started` (UC-06). */
  cold: boolean;
  text: string;
  steps: RunStep[];
  ask: Ask | null;
  error: RunError | null;
  quota: RunStartedData["quota"] | null;
  lastEventId: number;
  ms: number | null;
  /** Lần nối lại hiện tại (1..5), 0 khi không nối lại. */
  attempt: number;
  cancelling: boolean;
};

export type RunAction =
  | { type: "accepted"; runId: string; flowId: string; messageId: string }
  | { type: "events"; events: ChatEvent[] }
  | { type: "reconnecting"; attempt: number }
  | { type: "resumed" }
  | { type: "lost" }
  | { type: "cancelRequested" };

export const TERMINAL_PHASES: readonly RunPhase[] = ["finished", "asked", "failed", "cancelled"];

export function isTerminal(phase: RunPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/** Run còn chiếm flow/hội thoại (kể cả `lost`: Hub có thể vẫn đang chạy). */
export function isRunActive(run: Pick<RunState, "phase">): boolean {
  return !isTerminal(run.phase);
}

export type NewRunInput = {
  key: string;
  convId: string;
  origin: RunOrigin;
  request: RunRequest;
  /** `last_active_at` của flow đích (gửi vào flow có sẵn) — để tính `cold`. */
  flowLastActiveAt?: string;
  nowMs?: number;
};

export function createRunState(input: NewRunInput): RunState {
  const cold =
    input.flowLastActiveAt !== undefined &&
    isFlowIdle(input.flowLastActiveAt, input.nowMs ?? Date.now());
  return {
    key: input.key,
    convId: input.convId,
    runId: null,
    flowId: input.request.flowId ?? null,
    messageId: null,
    answerId: null,
    origin: input.origin,
    request: input.request,
    phase: cold ? "cold" : "sending",
    cold,
    text: "",
    steps: [],
    ask: null,
    error: null,
    quota: null,
    lastEventId: 0,
    ms: null,
    attempt: 0,
    cancelling: false,
  };
}

/** Gắn vào run đang chạy (mở hội thoại có `active_run_id`) — đọc lại từ sự kiện 1. */
export function createAttachedState(
  key: string,
  run: { convId: string; runId: string; flowId: string; origin: RunOrigin },
): RunState {
  const base = createRunState({
    key,
    convId: run.convId,
    origin: run.origin,
    request: { content: "" },
  });
  return { ...base, runId: run.runId, flowId: run.flowId, phase: "streaming" };
}

function onStep(s: RunState, e: ChatEvent): RunState {
  if (e.event === "step.started") {
    if (s.steps.some((x) => x.id === e.data.step_id)) return s;
    const step: RunStep = { id: e.data.step_id, label: e.data.label, status: "running", ms: null };
    return { ...s, steps: [...s.steps, step] };
  }
  if (e.event !== "step.finished") return s;
  const { step_id, status, ms } = e.data;
  return { ...s, steps: s.steps.map((x) => (x.id === step_id ? { ...x, status, ms } : x)) };
}

function applyEvent(s: RunState, e: ChatEvent): RunState {
  if (isTerminal(s.phase) || !isNewEvent(e.id, s.lastEventId)) return s;
  const next = { ...s, lastEventId: e.id };
  switch (e.event) {
    case "run.started":
      return {
        ...next,
        phase: "streaming",
        runId: e.data.run_id,
        flowId: e.data.flow_id,
        quota: e.data.quota,
      };
    case "delta":
      return { ...next, text: next.text + e.data.text };
    case "ask":
      return { ...next, ask: e.data };
    case "run.finished": {
      const phase = next.ask ? "asked" : "finished";
      return { ...next, phase, text: e.data.content, ms: e.data.ms, answerId: e.data.message_id };
    }
    case "run.failed": {
      const { code, message, hint, message_id } = e.data;
      const phase = code === "CANCELLED" ? "cancelled" : "failed";
      return { ...next, phase, error: { code, message, hint }, answerId: message_id };
    }
    default:
      return onStep(next, e);
  }
}

/** Pha chờ khi đã nối lại mà chưa có `run.started`. */
function pendingPhase(s: RunState): RunPhase {
  if (s.lastEventId > 0) return "streaming";
  return s.cold ? "cold" : "sending";
}

export function runReducer(s: RunState, a: RunAction): RunState {
  switch (a.type) {
    case "accepted":
      return { ...s, runId: a.runId, flowId: a.flowId, messageId: a.messageId };
    case "events":
      return a.events.reduce(applyEvent, s);
    case "reconnecting":
      return isTerminal(s.phase) ? s : { ...s, phase: "reconnecting", attempt: a.attempt };
    case "resumed":
      return isTerminal(s.phase) ? s : { ...s, phase: pendingPhase(s), attempt: 0 };
    case "lost":
      return isTerminal(s.phase) ? s : { ...s, phase: "lost", attempt: 0 };
    case "cancelRequested":
      return isTerminal(s.phase) ? s : { ...s, cancelling: true };
  }
}
