// CHAT-AC-14 · gọi Hub E11 (tin của một flow, cursor) — nơi duy nhất gọi API của feature flow-panel.
import type { ChatPage, Message } from "@ai/contracts/chat";
import { api } from "~/lib/http";

/** E11 · trang đầu = tin mới nhất, `items` sắp tăng; `next_cursor` = trang cũ hơn. */
export function listFlowMessages(
  convId: string,
  flowId: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ChatPage<Message>> {
  return api<ChatPage<Message>>(`/conversations/${encodeURIComponent(convId)}/messages`, {
    query: { flow_id: flowId, cursor },
    signal,
  });
}
