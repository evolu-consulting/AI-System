// CHAT-AC-19, CHAT-AC-21, CHAT-AC-22 · query danh sách (infinite, cursor) + đổi tên / xoá; F5/F7 gọi `useInvalidateConversations`.
import type { Conversation } from "@ai/contracts/chat";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CONVERSATIONS_KEY,
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
} from "../api";

export function useConversationList(q: string) {
  const term = q.trim();
  const query = useInfiniteQuery({
    queryKey: [CONVERSATIONS_KEY, term],
    queryFn: ({ pageParam, signal }) => listConversations(term, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items: Conversation[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...query, items };
}

/** Làm mới mọi danh sách (mọi `q`): sau tạo / đổi tên / xoá / run kết thúc. */
export function useInvalidateConversations() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [CONVERSATIONS_KEY] });
}

export function useRenameConversation() {
  const invalidate = useInvalidateConversations();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; title: string }) => renameConversation(v.id, v.title),
    onSuccess: (conv) => {
      qc.setQueryData(["conv", conv.id], conv);
      return invalidate();
    },
  });
}

export function useDeleteConversation() {
  const invalidate = useInvalidateConversations();
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: () => invalidate(),
  });
}

/** E6 · tạo hội thoại rồi làm mới danh sách (sidebar). */
export function useCreateConversation() {
  const invalidate = useInvalidateConversations();
  return useMutation({
    mutationFn: (title: string) => createConversation(title),
    onSuccess: () => void invalidate(),
  });
}
