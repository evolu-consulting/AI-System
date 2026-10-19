// M2-chat · luật thuần của khoang trợ lý: tin gửi Hub (tag `@mgmt-assistant` ⇒ chạy thẳng agent dùng chung, H2b), áp sự kiện
// SSE vào tin trả lời đang chạy, tiêu đề hội thoại, câu lỗi. Không I/O.
import type { ChatEvent, SendMessageRequest } from "@ai/contracts/chat";

/** Agent dùng chung của app mgmt ở Agent Hub (seed `apps/hub-api/seed/agents.yaml`). Đổi backend = đổi agent, không đổi đây. */
export const ASSISTANT_AGENT = "mgmt-assistant";
export const QUESTION_MAX = 4000;
const TITLE_MAX = 80;

export type Msg = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  step?: string;
  error?: string;
};

/** Tin E12: tag agent ở đầu, cùng flow sau câu đầu, kèm trang đang mở (ngữ cảnh cho trợ lý). */
export function buildRequest(
  question: string,
  flowId: string | null,
  pageUrl: string | null,
): SendMessageRequest {
  const body: SendMessageRequest = { content: `@${ASSISTANT_AGENT} ${question.trim()}` };
  if (flowId) body.flow_id = flowId;
  if (pageUrl) body.context = { page_url: pageUrl };
  return body;
}

/** Tiêu đề hội thoại Hub từ câu đầu (một dòng, ≤ 80 ký tự). */
export function titleOf(question: string): string {
  const one = question.replace(/\s+/g, " ").trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one || "Trợ lý";
}

/** Áp một sự kiện SSE vào tin trả lời. `run.finished.content` là bản đủ (thay phần delta đã ghép). */
export function applyEvent(m: Msg, e: ChatEvent): Msg {
  switch (e.event) {
    case "step.started":
      return { ...m, step: e.data.label };
    case "delta":
      return { ...m, text: m.text + e.data.text };
    case "ask":
      return { ...m, text: `${m.text}${m.text ? "\n\n" : ""}${e.data.question}` };
    case "run.finished":
      return { ...m, text: e.data.content || m.text, pending: false, step: undefined };
    case "run.failed":
      return { ...m, pending: false, step: undefined, error: e.data.message };
    default:
      return m;
  }
}

/** Câu lỗi cho người dùng theo mã lỗi Hub (trước stream); mã lạ ⇒ câu chung. */
export function errorText(code: string | undefined, t: (k: string) => string): string {
  switch (code) {
    case "AGENT_NOT_FOUND":
    case "DEFAULT_AGENT_FORBIDDEN":
    case "FORBIDDEN":
      return t("contracts.assistant.errForbidden");
    case "FLOW_BUSY":
    case "TOO_MANY_RUNS":
      return t("contracts.assistant.errBusy");
    default:
      return t("contracts.assistant.errGeneric");
  }
}
