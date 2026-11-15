// CR-132 · W2 · tổng chưa đọc (số đỏ ở menu / nút khoang): MỘT query `GET /messages/unread`; realtime cập nhật cache.
// Bộ nghe `msg.*` nạp lazy (kéo zod) để không nặng bundle đầu; nhiều nơi gọi hook này vẫn chỉ một bộ nghe (đếm số bên dùng).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchUnread, msgKeys } from "../api";

/** Bật nghe realtime cho tin nhắn khi component còn sống. */
export function useMsgRealtime(enabled = true): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    let release: (() => void) | undefined;
    void import("./msg-realtime").then((m) => {
      if (!dead) release = m.retain(qc);
    });
    return () => {
      dead = true;
      release?.();
    };
  }, [enabled, qc]);
}

export function useUnreadTotal(enabled = true): number {
  useMsgRealtime(enabled);
  const q = useQuery({
    queryKey: msgKeys.unread,
    queryFn: ({ signal }) => fetchUnread(signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return q.data?.total ?? 0;
}
