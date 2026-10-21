// M2-chat · luật thuần của khoang trợ lý: tin gửi Hub (tag `@assistant` ⇒ chạy thẳng agent dùng chung, H2b), áp sự kiện
// SSE vào tin trả lời đang chạy, tiêu đề hội thoại, câu lỗi. Không I/O.
// one-agent · MỘT trợ lý chung `assistant` (như AI System); dock gửi kèm ngữ cảnh nơi gửi (surface=contracts, màn hình, id
// HĐ / đối tác đang xem) — Hub kiểm RLS rồi mới chèn tên vào prompt.
import type { ChatEvent, MessageContext, SendMessageRequest } from "@ai/contracts/chat";

/** Agent mặc định ở Agent Hub = trợ lý chung (seed `apps/hub-api/seed/agents.yaml`, Claude + tool đọc). */
export const DEFAULT_ASSISTANT_AGENT = "assistant";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_MAX = 200;
const PARTY_MAX = 300;

/** Ngữ cảnh dock từ URL: `/contracts/<uuid>` ⇒ HĐ; `/partners?party=<khoá>` ⇒ đối tác; còn lại chỉ màn hình. */
export function dockContext(pathname: string, search: string): MessageContext {
  const route = pathname.startsWith("/") ? pathname.slice(0, ROUTE_MAX) : "/";
  const ctx: MessageContext = { surface: "contracts" };
  if (/^\/[^\s<>]*$/.test(route)) ctx.route = route;
  const id = /^\/contracts\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (id && UUID_RE.test(id)) return { ...ctx, entity: { kind: "contract", id } };
  const party = pathname === "/partners" ? new URLSearchParams(search).get("party") : null;
  if (party && party.length <= PARTY_MAX) return { ...ctx, entity: { kind: "partner", id: party } };
  return ctx;
}
const AGENT_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Cờ cấu hình chọn backend, không đổi code: env build `PUBLIC_ASSISTANT_AGENT` (vd `mgmt-assistant-dify`); vắng/sai dạng ⇒
 * mặc định. Hoặc giữ key và đổi runtime agent ở Hub (`hub:seed`).
 */
export function assistantAgent(env: Record<string, unknown> | undefined): string {
  const v = env?.PUBLIC_ASSISTANT_AGENT;
  return typeof v === "string" && AGENT_KEY_RE.test(v) ? v : DEFAULT_ASSISTANT_AGENT;
}
export const ASSISTANT_AGENT = assistantAgent({
  PUBLIC_ASSISTANT_AGENT: import.meta.env?.PUBLIC_ASSISTANT_AGENT,
});
export const QUESTION_MAX = 4000;

/** gap-a2 #6 · "Hỏi về hợp đồng này": cùng agent `assistant` (không agent mới), dặn chỉ dựa vào đúng HĐ đang xem (id lấy từ ngữ cảnh dock). */
export const CONTRACT_QA_INSTRUCTION =
  "Chỉ trả lời dựa trên văn bản và các trường của HỢP ĐỒNG đang xem (entity trong ngữ cảnh), không dùng hợp đồng khác. " +
  "Mỗi ý kèm trích dẫn nguyên văn đặt trong dấu ngoặc kép “…”; văn bản không nói tới thì trả lời rõ: không thấy trong hợp đồng này.";
const TITLE_MAX = 80;

export type Msg = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  step?: string;
  error?: string;
};

/** Tin E12: tag agent ở đầu, cùng flow sau câu đầu, kèm trang đang mở + ngữ cảnh dock (`dockContext`). */
export function buildRequest(
  question: string,
  flowId: string | null,
  pageUrl: string | null,
  dock?: MessageContext,
  instruction?: string,
): SendMessageRequest {
  const q = question.trim();
  const body: SendMessageRequest = {
    content: `@${ASSISTANT_AGENT} ${instruction ? `${instruction}\n\nCâu hỏi: ${q}` : q}`,
  };
  if (flowId) body.flow_id = flowId;
  const ctx: MessageContext = { ...(pageUrl ? { page_url: pageUrl } : {}), ...dock };
  if (Object.keys(ctx).length > 0) body.context = ctx;
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
