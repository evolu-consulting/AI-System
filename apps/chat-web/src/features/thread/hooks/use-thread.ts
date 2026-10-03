// CHAT-AC-05, CHAT-AC-20 · query hội thoại `['conv', id]` (E7) + flow `['conv', id, 'flows']` (E10, tự tải hết các trang).
// Run kết thúc → runtime invalidate `['conv', id]` → cả hai query làm mới.
import type { Flow } from "@ai/contracts/chat";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ApiError } from "~/lib/http";
import { getConversation, listFlows } from "../api";

export function useConversation(id: string) {
  return useQuery({
    queryKey: ["conv", id],
    queryFn: ({ signal }) => getConversation(id, signal),
  });
}

export function useFlows(id: string) {
  const query = useInfiniteQuery({
    queryKey: ["conv", id, "flows"],
    queryFn: ({ pageParam, signal }) => listFlows(id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  // E10 sắp tăng dần, flow mới nhất ở trang cuối → luồng chính cần đủ các trang.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const flows: Flow[] = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  return { ...query, flows };
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
