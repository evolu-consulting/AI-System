// HUB-FR-96 · chi tiết phòng + tin nhắn (trang lùi theo `before_seq`).
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRoom, listRoomMessages } from "../api";
import { roomKeys } from "../lib/room-cache";

export function useRoom(id: string) {
  return useQuery({
    queryKey: roomKeys.detail(id),
    queryFn: ({ signal }) => getRoom(id, signal),
    retry: false,
  });
}

/** `messages` hiển thị theo `seq` tăng dần (trang cũ nằm trước). */
export function useRoomMessages(id: string) {
  const query = useInfiniteQuery({
    queryKey: roomKeys.messages(id),
    queryFn: ({ pageParam, signal }) => listRoomMessages(id, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (first) => {
      const seq = first.items[0]?.seq;
      return first.has_more && seq !== undefined ? seq : undefined;
    },
    retry: false,
  });
  // `pages[0]` = mới nhất; trang kế (cũ hơn) được thêm cuối mảng.
  const messages = [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.items);
  return { ...query, messages, loadOlder: query.fetchNextPage, hasOlder: query.hasNextPage };
}
