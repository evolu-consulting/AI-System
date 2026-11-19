// CR-132 · W2 · danh sách hội thoại (MỘT query phân trang; không gọi lại theo từng hội thoại) + người nội bộ chọn được + tạo mới.
import type { ConversationDetail, CreateConversationRequest } from "@ai/contracts/pack-contracts";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  createConversation,
  fetchCompanies,
  fetchConversations,
  fetchPeople,
  msgKeys,
} from "../api";
import type { CompanyFilter } from "../lib/company-filter";
import { flattenList, type ListPages, sortConversations } from "../lib/conversations";
import { useMsgRealtime } from "./use-unread";

/** Danh sách cuộc (mới nhất trước), tải dần; `filter` = «Tất cả» / công ty mình / một công ty đã kết nối. */
export function useConversations(filter: CompanyFilter = "all", unread = false, enabled = true) {
  useMsgRealtime();
  const q = useInfiniteQuery({
    queryKey: msgKeys.listBy(filter, unread),
    queryFn: ({ pageParam, signal }) => fetchConversations(pageParam, filter, signal, unread),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
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
export function usePeople(enabled: boolean, q = "", filter: CompanyFilter = "own") {
  const r = useInfiniteQuery({
    queryKey: msgKeys.people(q, filter),
    queryFn: ({ pageParam, signal }) => fetchPeople(pageParam, q, signal, filter),
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

/** Công ty đã kết nối (chip lọc, «Công ty khác»), tải dần 30/lần; làm mới khi `cc.link` (kết nối/ngắt). */
export function useCompanies(enabled = true) {
  const r = useInfiniteQuery({
    queryKey: msgKeys.companies,
    queryFn: ({ pageParam, signal }) => fetchCompanies(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
    staleTime: 60_000,
    retry: false,
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
      void qc.invalidateQueries({ queryKey: msgKeys.dirAll });
    },
  });
}
