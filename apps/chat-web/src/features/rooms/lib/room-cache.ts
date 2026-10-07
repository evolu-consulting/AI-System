// X2a · query key + vá cache TanStack Query (thuần, không I/O) cho event-router (F2) và mutation (plan-frontend §3).
import type {
  RoomDetail,
  RoomListResponse,
  RoomMessage,
  RoomMessagePage,
  RoomSummary,
} from "@ai/contracts/chat";
import type { InfiniteData } from "@tanstack/react-query";

export const roomKeys = {
  all: ["rooms"] as const,
  list: ["rooms", "list"] as const,
  detail: (id: string) => ["rooms", "detail", id] as const,
  messages: (id: string) => ["rooms", "messages", id] as const,
};

export type RoomListData = InfiniteData<RoomListResponse, string | undefined>;
export type RoomMessagesData = InfiniteData<RoomMessagePage, number | undefined>;

/** `unread_total` của trang đầu (sự kiện `room.unread` vá trang này). */
export function unreadTotalOf(data: RoomListData | undefined): number {
  return data?.pages[0]?.unread_total ?? 0;
}

function mapPages(data: RoomListData, fn: (p: RoomListResponse) => RoomListResponse): RoomListData {
  return { ...data, pages: data.pages.map(fn) };
}

/** Vá một phòng trong list (không đổi thứ tự). */
export function patchRoomInList(
  data: RoomListData | undefined,
  id: string,
  patch: Partial<RoomSummary>,
): RoomListData | undefined {
  if (!data) return data;
  return mapPages(data, (p) => ({
    ...p,
    items: p.items.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));
}

/** Vá `unread_total` (trang đầu). */
export function patchUnreadTotal(
  data: RoomListData | undefined,
  total: number,
): RoomListData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p, i) => (i === 0 ? { ...p, unread_total: total } : p)),
  };
}

/** Đưa phòng lên đầu trang đầu; chưa có trong list thì chèn. */
export function moveRoomToTop(
  data: RoomListData | undefined,
  room: RoomSummary,
): RoomListData | undefined {
  if (!data) return data;
  const rest = mapPages(data, (p) => ({ ...p, items: p.items.filter((r) => r.id !== room.id) }));
  return {
    ...rest,
    pages: rest.pages.map((p, i) => (i === 0 ? { ...p, items: [room, ...p.items] } : p)),
  };
}

export function removeRoomFromList(
  data: RoomListData | undefined,
  id: string,
): RoomListData | undefined {
  if (!data) return data;
  return mapPages(data, (p) => ({ ...p, items: p.items.filter((r) => r.id !== id) }));
}

export function findRoomInList(
  data: RoomListData | undefined,
  id: string,
): RoomSummary | undefined {
  for (const p of data?.pages ?? []) {
    const hit = p.items.find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Chèn tin vào trang đầu (tin mới nhất), khử trùng theo `id`, giữ thứ tự `seq`. */
export function insertMessage(
  data: RoomMessagesData | undefined,
  msg: RoomMessage,
): RoomMessagesData | undefined {
  if (!data) return data;
  if (data.pages.some((p) => p.items.some((m) => m.id === msg.id))) return data;
  return {
    ...data,
    pages: data.pages.map((p, i) =>
      i === 0 ? { ...p, items: [...p.items, msg].sort((a, b) => a.seq - b.seq) } : p,
    ),
  };
}

/** `room.read`: `last_read_seq = max(cũ, seq)` cho một thành viên. */
export function patchMemberRead(
  detail: RoomDetail | undefined,
  userId: string,
  seq: number,
): RoomDetail | undefined {
  if (!detail) return detail;
  return {
    ...detail,
    members: detail.members.map((m) =>
      m.id === userId ? { ...m, last_read_seq: Math.max(m.last_read_seq, seq) } : m,
    ),
  };
}
