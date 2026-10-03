// CHAT-AC-19, CHAT-AC-21, CHAT-AC-22 · gọi Hub E5/E8/E9 (nơi duy nhất của feature conversations).
import type { ChatPage, Conversation } from "@ai/contracts/chat";
import { api } from "~/lib/http";

export const CONVERSATIONS_KEY = "conversations";

/** E5 · `q` rỗng không gửi (server bỏ dấu khi khớp). */
export function listConversations(
  q: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<ChatPage<Conversation>> {
  return api<ChatPage<Conversation>>("/conversations", {
    query: { q: q.trim() || undefined, cursor },
    signal,
  });
}

/** E8 */
export function renameConversation(id: string, title: string): Promise<Conversation> {
  return api<Conversation>(`/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { title },
  });
}

/** E9 */
export async function deleteConversation(id: string): Promise<void> {
  await api<unknown>(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** E6 · client tính `title = deriveTitle(content)` của tin đầu. */
export function createConversation(title: string): Promise<Conversation> {
  return api<Conversation>("/conversations", { method: "POST", body: { title } });
}
