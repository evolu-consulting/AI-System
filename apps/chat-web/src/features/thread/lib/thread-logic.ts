// CHAT-AC-05..07, CHAT-AC-20 · helper thuần của luồng chính: footer khối flow, autoscroll, run chờ flow, khi nào bỏ run.
import type { Ask, Flow, Message, Responder } from "@ai/contracts/chat";
import { isTerminal, type RunPhase, type RunState } from "~/features/run/lib/reducer";
import { recallResponder } from "~/features/run/lib/responder-cache";

/** Cách đáy ≤ 80px coi như đang ở đáy (plan-frontend §5 NewMessagesButton). */
export const NEAR_BOTTOM_PX = 80;

export function isNearBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

/** Số tin của flow ngoài câu hỏi + câu trả lời đầu ("+N tin trong flow"). */
export function extraMessages(flow: Pick<Flow, "message_count">): number {
  return Math.max(0, flow.message_count - 2);
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "2 phút trước" / "2 minutes ago" theo locale. */
export function relativeTime(iso: string, nowMs: number, locale: string): string {
  const diffS = Math.round((Date.parse(iso) - nowMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diffS) >= size) return rtf.format(Math.round(diffS / size), unit);
  }
  return rtf.format(0, "minute");
}

/**
 * Run gửi từ ô chính của hội thoại mà flow chưa có trong E10 (vừa gửi, chưa refetch) → khối flow tạm.
 * Trả chuỗi khoá (primitive) để selector `useRuns` ổn định.
 */
export function pendingRunKeys(
  runs: readonly RunState[],
  convId: string,
  flowIds: ReadonlySet<string>,
): string {
  return runs
    .filter((r) => r.convId === convId && r.origin === "main")
    .filter((r) => r.flowId === null || !flowIds.has(r.flowId))
    .map((r) => r.key)
    .join(",");
}

/** Run đã kết thúc và E10 đã chứa câu trả lời của nó → view bỏ run khỏi store (không nháy). */
export function shouldDismiss(run: RunState, flow: Pick<Flow, "preview">): boolean {
  return isTerminal(run.phase) && run.answerId !== null && flow.preview.answer?.id === run.answerId;
}

const LIVE_PHASES: readonly RunPhase[] = ["sending", "cold", "streaming", "reconnecting", "lost"];

/** Dữ liệu hiển thị một câu trả lời — từ run đang/vừa chạy hoặc từ tin đã lưu. */
export type AnswerView = {
  text: string;
  streaming: boolean;
  /** Chưa có chữ nào và run đang chờ (sending/cold). */
  waiting: boolean;
  cold: boolean;
  ask: Ask | null;
  error: { code: string; runId: string | null } | null;
  cancelled: boolean;
  /** F9 · bước đã/đang chạy (rỗng → không hiện danh sách). */
  steps?: AnswerStep[];
  /** F9 · để Thử lại / Chạy lại / chip hỏi lại gửi đúng chỗ; thiếu → không có nút gửi. */
  context?: AnswerContext | null;
  /** F9 · flow đã có tin sau câu hỏi lại → chip vô hiệu. */
  askAnswered?: boolean;
  /** HUB-FR-91 · agent trả lời (run `direct`); vắng → nhãn mặc định "Consultant". */
  responder?: Responder;
};

export type AnswerStep = {
  id: string;
  label: string;
  status: "running" | "ok" | "failed";
  ms: number | null;
};

export type AnswerContext = {
  convId: string;
  flowId: string | null;
  /** Nội dung tin user gốc của run (gửi lại nguyên văn). */
  content: string;
  /** `main` → Thử lại tạo flow mới; `flow` → cùng flow. */
  origin: "main" | "flow";
};

export function answerFromRun(run: RunState): AnswerView {
  const streaming = LIVE_PHASES.includes(run.phase);
  return {
    text: run.text,
    streaming,
    waiting: streaming && run.text === "",
    cold: run.phase === "cold",
    ask: run.ask,
    error: run.phase === "failed" && run.error ? { code: run.error.code, runId: run.runId } : null,
    cancelled: run.phase === "cancelled",
    steps: run.steps,
    context: {
      convId: run.convId,
      flowId: run.flowId,
      content: run.request.content,
      origin: run.origin,
    },
    askAnswered: false,
    ...(run.responder ? { responder: run.responder } : {}),
  };
}

export function answerFromMessage(
  m: Message,
  extra: { context?: AnswerContext | null; askAnswered?: boolean } = {},
): AnswerView {
  const status = m.run?.status;
  const responder = m.responder ?? recallResponder(m.id);
  return {
    text: m.content,
    streaming: false,
    waiting: false,
    cold: false,
    ask: m.ask,
    error: status === "failed" && m.run?.error ? { code: m.run.error.code, runId: m.run.id } : null,
    cancelled: status === "cancelled",
    steps: (m.run?.steps ?? []).map((x) => ({
      id: x.step_id,
      label: x.label,
      status: x.status,
      ms: x.ms,
    })),
    context: extra.context ?? null,
    askAnswered: extra.askAnswered ?? false,
    ...(responder ? { responder } : {}),
  };
}
