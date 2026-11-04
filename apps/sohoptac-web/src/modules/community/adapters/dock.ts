// com-c10b · dock "Hỏi trợ lý giá" gọi Agent Hub (proxy cùng origin `/conversations`, `/runs`): E6 tạo hội thoại, E12 gửi tin
// (SSE), E15 dừng — header `X-Ai-Surface: community` (hub 0063): công ty không có Chat AI vẫn dùng dock khi có quyền đọc gói.
import {
  AI_SURFACE_HEADER,
  type ChatEvent,
  type Conversation,
  FLOW_ID_HEADER,
  RUN_ID_HEADER,
  type SendMessageRequest,
} from "@ai/contracts/chat";
import { ApiError, api, apiResponse } from "@ai/web-kit/http";
import { readEvents } from "@ai/web-kit/sse";

const DOCK = { [AI_SURFACE_HEADER]: "community" };

export function createConversation(title: string): Promise<Conversation> {
  return api<Conversation>("/conversations", { method: "POST", body: { title }, headers: DOCK });
}

export type Sent = { runId: string | null; flowId: string | null };

export async function sendAndStream(
  convId: string,
  req: SendMessageRequest,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<Sent> {
  const res = await apiResponse(`/conversations/${encodeURIComponent(convId)}/messages`, {
    method: "POST",
    body: req,
    headers: { Accept: "text/event-stream", ...DOCK },
    signal,
  });
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  const sent = { runId: res.headers.get(RUN_ID_HEADER), flowId: res.headers.get(FLOW_ID_HEADER) };
  await readEvents(res.body, onEvent, signal);
  return sent;
}

export async function cancelRun(runId: string): Promise<void> {
  await api<unknown>(`/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: DOCK,
  });
}
