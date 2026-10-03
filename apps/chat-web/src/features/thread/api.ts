// CHAT-AC-05, CHAT-AC-20 · gọi Hub E7 (hội thoại) + E10 (flow, cursor) — nơi duy nhất gọi API của feature thread.
import type { ChatPage, Conversation, Flow } from "@ai/contracts/chat";
import { api } from "~/lib/http";

const convPath = (id: string) => `/conversations/${encodeURIComponent(id)}`;

/** E7 */
export function getConversation(id: string, signal?: AbortSignal): Promise<Conversation> {
  return api<Conversation>(convPath(id), { signal });
}

/** E10 · sắp `created_at` tăng (luồng từ trên xuống); `next_cursor` = trang sau. */
export function listFlows(
  id: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ChatPage<Flow>> {
  return api<ChatPage<Flow>>(`${convPath(id)}/flows`, { query: { cursor }, signal });
}
