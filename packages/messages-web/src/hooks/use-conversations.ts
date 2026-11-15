// CR-132 · W2 · danh sách hội thoại (MỘT query phân trang; không gọi lại theo từng hội thoại) + người nội bộ chọn được + tạo mới.
import type { ConversationDetail, CreateConversationRequest } from "@ai/contracts/pack-contracts";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { createConversation, fetchConversations, fetchPeople, msgKeys } from "../api";
import { flattenList, type ListPages, sortConversations } from "../lib/conversations";
import { useMsgRealtime } from "./use-unread";

export function useConversations() {
  useMsgRealtime();
  const q = useInfiniteQuery({
    queryKey: msgKeys.list,
    queryFn: ({ pageParam, signal }) => fetchConversations(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
    retry: false,
  });
  const items = useMemo(
    () => sortConversations(flattenList(q.data as ListPages | undefined)),
    [q.data],
  );
  return { ...q, items };
}

/** Danh bạ nội bộ TẢI DẦN 30/lần (theo phòng ban rồi tên); `q` lọc ở server. Bật khi mở hộp «Nhắn tin mới» / «Thêm người» hoặc cột trái. */
export function usePeople(enabled: boolean, q = "") {
  const r = useInfiniteQuery({
    queryKey: msgKeys.people(q),
    queryFn: ({ pageParam, signal }) => fetchPeople(pageParam, q, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => r.data?.pages.flatMap((p) => p.items) ?? [], [r.data]);
  return { ...r, items };
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation<ConversationDetail, Error, CreateConversationRequest>({
    mutationFn: createConversation,
    onSuccess: (d) => {
      qc.setQueryData(msgKeys.detail(d.id), d);
      void qc.invalidateQueries({ queryKey: msgKeys.list });
    },
  });
}
