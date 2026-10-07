// HUB-FR-99, HUB-FR-100, CHAT-AC-37…40, X2a-AC08 · sự kiện `/me/stream` → cập nhật cache TanStack Query (plan-frontend §3).
// Component chỉ đọc query; không có store riêng cho dữ liệu phòng. Vá cache dùng hàm thuần của `rooms/lib/room-cache`.
import {
  type MeStreamEvent,
  ROOM_PREVIEW_MAX,
  type RoomDetail,
  type RoomMessage,
  type RoomSummary,
} from "@ai/contracts/chat";
import type { QueryClient } from "@tanstack/react-query";
import {
  insertMessage,
  moveRoomToTop,
  patchMemberRead,
  patchRoomInList,
  patchUnreadTotal,
  type RoomListData,
  type RoomMessagesData,
  removeRoomFromList,
  roomKeys,
} from "~/features/rooms/lib/room-cache";

/** Lý do phòng không còn với tôi (F6 dùng để điều hướng `/c/new` + toast nếu đang mở). */
export type RoomLostReason = "removed" | "deleted";

export type EventRouterDeps = {
  client: QueryClient;
  myId(): string | null;
  onRoomLost(roomId: string, reason: RoomLostReason): void;
};

type Of<N extends MeStreamEvent["event"]> = Extract<MeStreamEvent, { event: N }>["data"];

function lastMessageOf(m: RoomMessage) {
  return {
    seq: m.seq,
    sender_type: m.sender_type,
    sender: m.sender,
    preview: m.content.slice(0, ROOM_PREVIEW_MAX),
    created_at: m.created_at,
  };
}

type Ctx = {
  client: QueryClient;
  deps: EventRouterDeps;
  patchList(fn: (d: RoomListData | undefined) => RoomListData | undefined): void;
  patchDetail(id: string, fn: (d: RoomDetail | undefined) => RoomDetail | undefined): void;
  dropRoom(id: string, reason: RoomLostReason): void;
};

function makeCtx(deps: EventRouterDeps): Ctx {
  const { client } = deps;
  const patchList: Ctx["patchList"] = (fn) => {
    client.setQueryData<RoomListData>(roomKeys.list, fn);
  };
  const patchDetail: Ctx["patchDetail"] = (id, fn) => {
    client.setQueryData<RoomDetail>(roomKeys.detail(id), fn);
  };
  const dropRoom: Ctx["dropRoom"] = (id, reason) => {
    patchList((d) => removeRoomFromList(d, id));
    client.removeQueries({ queryKey: roomKeys.detail(id) });
    client.removeQueries({ queryKey: roomKeys.messages(id) });
    deps.onRoomLost(id, reason);
  };
  return { client, deps, patchList, patchDetail, dropRoom };
}

const findInList = (d: RoomListData | undefined, id: string) =>
  d?.pages.flatMap((p) => p.items).find((r) => r.id === id);

function onMessage(c: Ctx, { room_id, message }: Of<"room.message">): void {
  c.client.setQueryData<RoomMessagesData>(roomKeys.messages(room_id), (d) =>
    insertMessage(d, message),
  );
  if (!findInList(c.client.getQueryData<RoomListData>(roomKeys.list), room_id)) {
    void c.client.invalidateQueries({ queryKey: roomKeys.list });
    return;
  }
  const patch = {
    last_message: lastMessageOf(message),
    last_seq: message.seq,
    last_activity_at: message.created_at,
  };
  c.patchList((d) => {
    const cur = findInList(d, room_id);
    return cur && message.seq >= cur.last_seq ? moveRoomToTop(d, { ...cur, ...patch }) : d;
  });
  c.patchDetail(room_id, (d) => (d && message.seq >= d.last_seq ? { ...d, ...patch } : d));
}

function onUnread(c: Ctx, { room_id, unread, total }: Of<"room.unread">): void {
  c.patchList((d) => patchUnreadTotal(patchRoomInList(d, room_id, { unread }), total));
  c.patchDetail(room_id, (d) => (d ? { ...d, unread } : d));
}

function onMemberAdded(c: Ctx, { room_id, user_id, room }: Of<"room.member_added">): void {
  if (user_id === c.deps.myId()) {
    if (room) c.patchList((d) => moveRoomToTop(d, room));
    else void c.client.invalidateQueries({ queryKey: roomKeys.list });
    return;
  }
  void c.client.invalidateQueries({ queryKey: roomKeys.detail(room_id) });
  void c.client.invalidateQueries({ queryKey: roomKeys.list });
}

function onMemberRemoved(c: Ctx, { room_id, user_id }: Of<"room.member_removed">): void {
  if (user_id === c.deps.myId()) {
    c.dropRoom(room_id, "removed");
    return;
  }
  void c.client.invalidateQueries({ queryKey: roomKeys.detail(room_id) });
  void c.client.invalidateQueries({ queryKey: roomKeys.list });
}

function onUpdated(c: Ctx, { room_id, name, owner_id }: Of<"room.updated">): void {
  const patchFor = (kind: string): Partial<RoomSummary> => ({
    ...(name ? { name } : {}),
    ...(kind === "group" && owner_id
      ? { my_role: owner_id === c.deps.myId() ? "owner" : "member" }
      : {}),
  });
  c.patchList((d) => {
    const cur = findInList(d, room_id);
    return cur ? patchRoomInList(d, room_id, patchFor(cur.kind)) : d;
  });
  c.patchDetail(room_id, (d) =>
    d ? { ...d, ...patchFor(d.kind), ...(owner_id ? { owner_id } : {}) } : d,
  );
}

export function createEventRouter(deps: EventRouterDeps): (e: MeStreamEvent) => void {
  const c = makeCtx(deps);
  return (e) => {
    switch (e.event) {
      case "room.message":
        return onMessage(c, e.data);
      case "room.unread":
        return onUnread(c, e.data);
      case "room.read":
        return c.patchDetail(e.data.room_id, (d) => patchMemberRead(d, e.data.user_id, e.data.seq));
      case "room.member_added":
        return onMemberAdded(c, e.data);
      case "room.member_removed":
        return onMemberRemoved(c, e.data);
      case "room.updated":
        return onUpdated(c, e.data);
      case "room.deleted":
        return c.dropRoom(e.data.room_id, "deleted");
      case "stream.reset":
        // Giữ UI (không xoá cache trước): refetch list + detail/messages đang mở.
        void c.client.invalidateQueries({ queryKey: roomKeys.all });
        return;
    }
  };
}
