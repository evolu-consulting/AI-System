// CR-169 · lát 6 · Bảng tin công khai của công ty đã kết nối (đã che; chỉ chữ + số tệp), tải dần 20/lần. Bật khi hộp «Bảng tin» mở.
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchFeed, msgKeys } from "../api";

export function useFeed(tenant: string, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: msgKeys.feed(tenant),
    queryFn: ({ pageParam, signal }) => fetchFeed(tenant, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return { ...q, items };
}
