// HUB-FR-131 · danh sách kết nối (cursor, gộp trang) + `allowed_origins` của trang đầu.
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { khConnectionsQuery } from "../api";

export function useKhConnections() {
  const q = useInfiniteQuery(khConnectionsQuery);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const origins = q.data?.pages[0]?.allowed_origins ?? [];
  return { ...q, items, origins };
}
