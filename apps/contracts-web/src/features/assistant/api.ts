// M2-chat · trợ lý gọi Agent Hub (proxy cùng origin `/conversations`, `/runs` → hub-api): E6 tạo hội thoại, E12 gửi tin
// (stream SSE), E15 dừng. Lỗi trước stream (4xx/5xx JSON) ⇒ `ApiError` của web-kit. Đọc SSE bằng `readEvents` (web-kit).
import {
  type ChatEvent,
  type Conversation,
  FLOW_ID_HEADER,
  RUN_ID_HEADER,
  type SendMessageRequest,
} from "@ai/contracts/chat";
import { ApiError, api, apiResponse } from "@ai/web-kit/http";
import { readEvents } from "@ai/web-kit/sse";

export function createConversation(title: string): Promise<Conversation> {
  return api<Conversation>("/conversations", { method: "POST", body: { title } });
}

export type Sent = { runId: string | null; flowId: string | null };

/** E12: gửi rồi đọc stream tới sự kiện kết thúc (hoặc `signal` huỷ). */
export async function sendAndStream(
  convId: string,
  req: SendMessageRequest,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<Sent> {
  const res = await apiResponse(`/conversations/${encodeURIComponent(convId)}/messages`, {
    method: "POST",
    body: req,
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  const sent = { runId: res.headers.get(RUN_ID_HEADER), flowId: res.headers.get(FLOW_ID_HEADER) };
  await readEvents(res.body, onEvent, signal);
  return sent;
}

/** E15: dừng run (idempotent); kết quả thật đến qua stream (`run.failed CANCELLED`). */
export async function cancelRun(runId: string): Promise<void> {
  await api<unknown>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}
