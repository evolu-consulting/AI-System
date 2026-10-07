// HUB-FR-96 · HUB-FR-97 · map hàng DB (repo) → kiểu contract `@ai/contracts/chat` (X2a plan §2.3, D2, D5). Thuần.
// `sender` join `admin.users` (left join): thiếu tên ⇒ fallback `username` rồi id (không bao giờ rỗng).
import type {
  RoomDetail,
  RoomLastMessage,
  RoomMember,
  RoomMessage,
  RoomSummary,
} from "@ai/contracts/chat";
import { previewOf, type RoomKind, type RoomRole, unreadOf } from "./rooms.rules";

type SenderType = RoomMessage["sender_type"];
export type UserRefRow = { id: string; displayName: string | null; username: string | null };

export type RoomMessageRow = {
  id: string;
  roomId: string;
  seq: number;
  senderType: SenderType;
  sender: UserRefRow;
  content: string;
  clientMsgId: string | null;
  createdAt: Date;
};

export type LastMessageRow = {
  seq: number;
  senderType: SenderType;
  sender: UserRefRow;
  content: string;
  createdAt: Date;
};

export type RoomSummaryRow = {
  id: string;
  kind: RoomKind;
  name: string | null;
  peer: UserRefRow | null;
  memberCount: number;
  myRole: RoomRole;
  lastSeq: number;
  lastReadSeq: number;
  lastActivityAt: Date;
  last: LastMessageRow | null;
};

export type RoomMemberRow = {
  user: UserRefRow;
  role: RoomRole;
  lastReadSeq: number;
  joinedAt: Date;
};

const nameOf = (u: UserRefRow): string => u.displayName || u.username || u.id;
const senderOf = (u: UserRefRow) => ({ id: u.id, display_name: nameOf(u) });
const userRef = (u: UserRefRow) => ({ ...senderOf(u), username: u.username || u.id });

export function toRoomMessage(r: RoomMessageRow): RoomMessage {
  return {
    id: r.id,
    room_id: r.roomId,
    seq: r.seq,
    sender_type: r.senderType,
    sender: senderOf(r.sender),
    content: r.content,
    client_msg_id: r.clientMsgId,
    created_at: r.createdAt.toISOString(),
  };
}

export function toLastMessage(r: LastMessageRow): RoomLastMessage {
  return {
    seq: r.seq,
    sender_type: r.senderType,
    sender: senderOf(r.sender),
    preview: previewOf(r.content),
    created_at: r.createdAt.toISOString(),
  };
}

/** DM: `name`/`my_role` null, `peer` = người kia; nhóm: `peer` null (contract §2.3). */
export function toRoomSummary(r: RoomSummaryRow): RoomSummary {
  const dm = r.kind === "dm";
  return {
    id: r.id,
    kind: r.kind,
    name: dm ? null : r.name,
    peer: dm && r.peer ? userRef(r.peer) : null,
    member_count: r.memberCount,
    my_role: dm ? null : r.myRole,
    last_message: r.last ? toLastMessage(r.last) : null,
    last_seq: r.lastSeq,
    unread: unreadOf(r.lastSeq, r.lastReadSeq),
    last_activity_at: r.lastActivityAt.toISOString(),
  };
}

export function toRoomMember(m: RoomMemberRow): RoomMember {
  return {
    ...userRef(m.user),
    role: m.role,
    last_read_seq: m.lastReadSeq,
    joined_at: m.joinedAt.toISOString(),
  };
}

/** D2: `owner_id` suy từ `room_members.role` (DM ⇒ null). `members` = thành viên hiện tại. */
export function toRoomDetail(
  s: RoomSummaryRow,
  members: readonly RoomMemberRow[],
  createdAt: Date,
): RoomDetail {
  const owner = s.kind === "group" ? members.find((m) => m.role === "owner") : undefined;
  return {
    ...toRoomSummary(s),
    owner_id: owner?.user.id ?? null,
    created_at: createdAt.toISOString(),
    members: members.map(toRoomMember),
  };
}
