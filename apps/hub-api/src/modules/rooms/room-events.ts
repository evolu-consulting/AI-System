// HUB-FR-99 · HUB-FR-100 · dựng sự kiện `/me/stream` của phòng (X2a plan §8, plan-db §5; spec R19, R20). Thuần:
// service tính người nhận TRONG transaction (sau khi giữ khoá phòng), phát qua `publishUserEvents` SAU commit.
// Mỗi sự kiện không có người nhận trùng (R19r).
import type { RoomMessage, RoomSummary } from "@ai/contracts/chat";
import type { UserEvent } from "../../lib/user-stream";

/** Một hàng `hub.room_fanout(room)` (D13): chưa đọc của phòng + tổng chưa đọc của người nhận. */
export type FanoutRow = { user_id: string; unread: number; total: number };
export type UnreadSelf = { unread: number; total: number };
export type AddedMember = { userId: string; room?: RoomSummary };

const uniq = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Tin mới: `room.message` cho mọi thành viên (gồm người gửi) + `room.unread` riêng từng người. */
export function messageEvents(
  roomId: string,
  msg: RoomMessage,
  fanout: readonly FanoutRow[],
): UserEvent[] {
  const seen = new Set<string>();
  const rows = fanout.filter((f) => !seen.has(f.user_id) && seen.add(f.user_id));
  if (rows.length === 0) return [];
  const all: UserEvent = {
    userIds: rows.map((f) => f.user_id),
    event: "room.message",
    data: { room_id: roomId, message: msg },
  };
  return [
    all,
    ...rows.map(
      (f): UserEvent => ({
        userIds: [f.user_id],
        event: "room.unread",
        data: { room_id: roomId, unread: f.unread, total: f.total },
      }),
    ),
  ];
}

/** Đã đọc: `room.read` cho thành viên khác; `room.unread` cho chính mình (đồng bộ tab, R18). */
export function readEvents(
  roomId: string,
  userId: string,
  seq: number,
  memberIds: readonly string[],
  self: UnreadSelf,
): UserEvent[] {
  const others = uniq(memberIds).filter((id) => id !== userId);
  const out: UserEvent[] = [
    { userIds: [userId], event: "room.unread", data: { room_id: roomId, ...self } },
  ];
  if (others.length > 0)
    out.push({
      userIds: others,
      event: "room.read",
      data: { room_id: roomId, user_id: userId, seq },
    });
  return out;
}

/** Thêm thành viên: người mới nhận bản có `room` (summary của họ); thành viên khác nhận `{room_id, user_id}`. */
export function memberAddedEvents(
  roomId: string,
  added: readonly AddedMember[],
  memberIds: readonly string[],
): UserEvent[] {
  return added.flatMap((a): UserEvent[] => {
    const others = uniq(memberIds).filter((id) => id !== a.userId);
    const base = { room_id: roomId, user_id: a.userId };
    const mine: UserEvent = {
      userIds: [a.userId],
      event: "room.member_added",
      data: a.room ? { ...base, room: a.room } : base,
    };
    return others.length > 0
      ? [mine, { userIds: others, event: "room.member_added", data: base }]
      : [mine];
  });
}

/** Bớt/rời: người bị bớt + mọi người còn lại, mỗi người đúng 1 lần (R20). */
export function memberRemovedEvents(
  roomId: string,
  removedId: string,
  remainingIds: readonly string[],
): UserEvent[] {
  return [
    {
      userIds: uniq([removedId, ...remainingIds]),
      event: "room.member_removed",
      data: { room_id: roomId, user_id: removedId },
    },
  ];
}

/** Đổi tên / chuyển chủ. */
export function updatedEvents(
  roomId: string,
  memberIds: readonly string[],
  patch: { name?: string; owner_id?: string },
): UserEvent[] {
  const userIds = uniq(memberIds);
  return userIds.length > 0
    ? [{ userIds, event: "room.updated", data: { room_id: roomId, ...patch } }]
    : [];
}

/** Xoá phòng: mọi thành viên lúc xoá. */
export function deletedEvents(roomId: string, memberIds: readonly string[]): UserEvent[] {
  const userIds = uniq(memberIds);
  return userIds.length > 0 ? [{ userIds, event: "room.deleted", data: { room_id: roomId } }] : [];
}
