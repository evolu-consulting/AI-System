// CR-178 · M3 · dữ liệu «Tìm tin» (mọi cuộc / một cuộc) và «Ảnh & tệp» (mỗi loại một danh sách tải dần).
import type { MsgAttachKind } from "@ai/contracts/pack-contracts";
import { MSG_SEARCH_Q_MIN } from "@ai/contracts/pack-contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAttachments, fetchSearch, msgKeys } from "../api";
import { mergeAttachPages, mergeSearchPages } from "../lib/find";

export const canSearch = (q: string): boolean => q.trim().length >= MSG_SEARCH_Q_MIN;

/** Kết quả tìm (mới nhất trước), tải dần; `q` < 2 ký tự ⇒ không gọi. `conversationId` có ⇒ chỉ trong cuộc đó. */
export function useMessageSearch(q: string, conversationId: string | null) {
  const term = q.trim();
  const query = useInfiniteQuery({
    queryKey: msgKeys.search(term, conversationId),
    queryFn: ({ pageParam, signal }) => fetchSearch(term, conversationId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: canSearch(term),
    retry: false,
    staleTime: 15_000,
  });
  const items = useMemo(() => mergeSearchPages(query.data?.pages ?? []), [query.data]);
  return { ...query, items };
}

/** «Ảnh» hoặc «Tệp» của một cuộc (mới nhất trước), tải dần. `enabled` = sheet đang mở. */
export function useAttachments(id: string, kind: MsgAttachKind, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: msgKeys.attach(id, kind),
    queryFn: ({ pageParam, signal }) => fetchAttachments(id, kind, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
    retry: false,
    staleTime: 15_000,
  });
  const items = useMemo(() => mergeAttachPages(query.data?.pages ?? []), [query.data]);
  return { ...query, items };
}
