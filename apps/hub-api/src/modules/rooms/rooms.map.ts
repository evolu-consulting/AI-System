// HUB-FR-96 · HUB-FR-97 · map hàng DB (repo) → kiểu contract `@ai/contracts/chat` (X2a plan §2.3, D2, D5). Thuần.
// `sender` join `admin.users` (left join): thiếu tên ⇒ fallback `username` rồi id (không bao giờ rỗng).
import type {
  RoomActiveRun,
  RoomAgentRef,
  RoomAsk,
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
  /** X2b D12 · thread (vắng = tin timeline X2a). */
  flowId?: string;
  placement?: "main" | "flow";
  /** X2b · tin agent: phần đã chọn theo người xem (D3 — `content`/`ask` riêng chỉ cho người gọi). */
  agent?: AgentPartRow;
  /** X2b · tóm tắt thread trên tin agent `main` gốc (chỉ khi đọc danh sách). */
  flow?: { messageCount: number; lastActiveAt: Date };
};

export type AgentPartRow = {
  runId: string;
  triggerMessageId: string;
  runStatus: "finished" | "failed" | "cancelled";
  ask?: RoomAsk;
  steps?: { count: number; ms: number };
  /** null = Orchestrator. */
  ref: RoomAgentRef | null;
  caller: UserRefRow;
};

/** X2b-R10 · một phần tử `active_runs` (definer `room_run_states`). */
export type ActiveRunRow = {
  runId: string;
  flowId: string;
  triggerMessageId: string;
  /** null = Orchestrator. */
  agent: RoomAgentRef | null;
  caller: UserRefRow;
  status: "running" | "waiting";
  waitKind?: "need_input" | "side_effect";
  startedAt: Date;
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
    ...(r.flowId && { flow_id: r.flowId, placement: r.placement ?? "main" }),
    ...(r.agent && agentFields(r.agent)),
    ...(r.flow && {
      flow: {
        message_count: r.flow.messageCount,
        last_active_at: r.flow.lastActiveAt.toISOString(),
      },
    }),
  };
}

function agentFields(a: AgentPartRow): Partial<RoomMessage> {
  return {
    run_id: a.runId,
    trigger_message_id: a.triggerMessageId,
    run_status: a.runStatus,
    caller: senderOf(a.caller),
    ...(a.ref && { agent: a.ref }),
    ...(a.ask && { ask: a.ask }),
    ...(a.steps && { steps: a.steps }),
  };
}

export function toActiveRun(r: ActiveRunRow): RoomActiveRun {
  return {
    run_id: r.runId,
    flow_id: r.flowId,
    trigger_message_id: r.triggerMessageId,
    agent: r.agent,
    caller: senderOf(r.caller),
    status: r.status,
    ...(r.waitKind && { wait_kind: r.waitKind }),
    started_at: r.startedAt.toISOString(),
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
