// HUB-FR-96 · danh sách phòng (infinite, cursor) + `unread_total` từ trang đầu.
import type { RoomSummary } from "@ai/contracts/chat";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { listRooms } from "../api";
import { type RoomListData, roomKeys, unreadTotalOf } from "../lib/room-cache";

export function useRoomList() {
  const query = useInfiniteQuery({
    queryKey: roomKeys.list,
    queryFn: ({ pageParam, signal }) => listRooms(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });
  const items: RoomSummary[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...query, items };
}

/** Tổng chưa đọc: chỉ đọc cache của list (không tự fetch). */
export function useUnreadTotal(): number {
  return (
    useQuery<RoomListData, Error, number>({
      queryKey: roomKeys.list,
      enabled: false,
      select: unreadTotalOf,
    }).data ?? 0
  );
}
