// CHAT-AC-05, CHAT-AC-20 · query hội thoại `['conv', id]` (E7) + flow `['conv', id, 'flows']` (E10, CR-051: tải dần khi cuộn lên).
// Run kết thúc → runtime invalidate `['conv', id]` → cả hai query làm mới.
import type { Flow } from "@ai/contracts/chat";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { ApiError } from "~/lib/http";
import { getConversation, listFlows } from "../api";

export function useConversation(id: string) {
  return useQuery({
    queryKey: ["conv", id],
    queryFn: ({ signal }) => getConversation(id, signal),
  });
}

/**
 * CR-051 · trang đầu = 30 flow mới nhất (E10 `order=desc`), cuộn lên đỉnh mới tải trang cũ hơn (`loadOlder`).
 * `flows` luôn tăng dần (cũ → mới). `want` = flow cần mở (`?flow=`) chưa có trong các trang đã tải ⇒ tải tiếp tới khi thấy.
 */
export function useFlows(id: string, want?: string) {
  const query = useInfiniteQuery({
    queryKey: ["conv", id, "flows"],
    queryFn: ({ pageParam, signal }) => listFlows(id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const flows: Flow[] = useMemo(
    () => (query.data?.pages.flatMap((p) => p.items) ?? []).reverse(),
    [query.data],
  );
  const missing = want !== undefined && !flows.some((f) => f.id === want);
  useEffect(() => {
    if (missing && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [missing, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const loadOlder = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return { ...query, flows, loadOlder };
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
