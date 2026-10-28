// com-c10b · luật thuần của dock "Hỏi trợ lý giá": ngữ cảnh trang gửi Hub, tin E12 (tag `@assistant` ⇒ agent dùng chung),
// áp sự kiện SSE vào tin trả lời, tiêu đề hội thoại, câu lỗi, câu gợi ý. Không I/O. Chỉ chủ quản (nội bộ) thấy dock.
import type { ChatEvent, MessageContext, SendMessageRequest } from "@ai/contracts/chat";

export const ASSISTANT_AGENT = "assistant";
export const QUESTION_MAX = 4000;
const TITLE_MAX = 80;
const SELECTION_MAX = 200;

/** Câu gợi ý (mockup: chip). */
export const DOCK_SUGGESTIONS = ["Giá chữ ký số USB Token?", "Hôm nay có gì mới?"] as const;

/** Chỉ chủ quản nội bộ có dock: đối tác (`partner`) không bao giờ (Chat AI bị chặn phía Hub, C2 — ở đây ẩn nút). */
export const dockVisible = (role: string): boolean => role !== "partner";

export type PageState = { route: "feed" | "profile" | "settings"; orgId?: string; search?: string };

/** Ngữ cảnh trang: bề mặt `community` + màn hình đang mở (`/feed`, `/profile/<org>`) + từ khoá đang tìm (nếu có). */
export function dockContext(p: PageState): MessageContext {
  const route = `/${p.route}${p.orgId && /^[\w-]{1,100}$/.test(p.orgId) ? `/${p.orgId}` : ""}`;
  const q = p.search?.replace(/\s+/g, " ").trim().slice(0, SELECTION_MAX);
  return {
    surface: "community",
    route,
    ...(q ? { selection: `Đang tìm trên bảng tin: ${q}` } : {}),
  };
}

export type Msg = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  step?: string;
  error?: string;
};

/** Tin E12: tag agent ở đầu, cùng flow sau câu đầu, kèm ngữ cảnh trang. */
export function buildRequest(
  question: string,
  flowId: string | null,
  ctx: MessageContext,
): SendMessageRequest {
  const body: SendMessageRequest = {
    content: `@${ASSISTANT_AGENT} ${question.trim().slice(0, QUESTION_MAX)}`,
    context: ctx,
  };
  if (flowId) body.flow_id = flowId;
  return body;
}

export function titleOf(question: string, fallback = "Trợ lý giá"): string {
  const one = question.replace(/\s+/g, " ").trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one || fallback;
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

/** Câu lỗi theo mã lỗi Hub (trước stream); mã lạ ⇒ câu chung. */
export function errorText(code: string | undefined): string {
  switch (code) {
    case "CHAT_APP_DISABLED":
    case "AGENT_NOT_FOUND":
    case "DEFAULT_AGENT_FORBIDDEN":
    case "FORBIDDEN":
      return "Bạn chưa được dùng Trợ lý giá. Nhờ quản trị cấp quyền đọc gói Cộng đồng.";
    case "FLOW_BUSY":
    case "TOO_MANY_RUNS":
      return "Trợ lý đang bận, thử lại sau giây lát.";
    default:
      return "Trợ lý chưa trả lời được. Thử lại sau.";
  }
}
