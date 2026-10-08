// HUB-FR-99 · HUB-FR-101 · X2b sự kiện run phòng qua `/me/stream` (plan §7, D10). Thuần: người nhận tính TRONG tx gọi (dưới
// khoá `rooms`), phát qua `publishUserEvents` SAU commit. Không nội dung tin / tham số (R12).
import type { RoomAgentRef, RoomMessage } from "@ai/contracts/chat";
import type { UserEvent } from "../../../lib/user-stream";
import { type FanoutRow, messageEvents } from "../room-events";

export type RunStarted = {
  roomId: string;
  runId: string;
  /** Thread (= `room_messages.flow_id` của tin gọi). */
  flowId: string;
  trigger: RoomMessage;
  /** null = Orchestrator (không tag / nhiều tag / `@orchestrator` / trả lời). */
  agent: RoomAgentRef | null;
};

/** `room.run_started` cho mọi thành viên hiện tại (gồm người gọi), mỗi người đúng 1 lần. */
export function runStartedEvents(s: RunStarted, memberIds: readonly string[]): UserEvent[] {
  const userIds = [...new Set(memberIds)];
  if (userIds.length === 0) return [];
  const { sender } = s.trigger;
  return [
    {
      userIds,
      event: "room.run_started",
      data: {
        room_id: s.roomId,
        run_id: s.runId,
        flow_id: s.flowId,
        trigger_message_id: s.trigger.id,
        agent: s.agent,
        caller: { id: sender.id, display_name: sender.display_name },
      },
    },
  ];
}

export type RunClosed = {
  roomId: string;
  runId: string;
  /** Thread của lượt. */
  flowId: string;
  callerId: string;
  status: "finished" | "failed" | "cancelled";
  waitKind: "need_input" | "side_effect" | null;
  /** Tin agent vừa đăng; null = không đăng (R17). */
  messageId: string | null;
};

/** Sau tx2 (reason ≠ `already`): `room.run_waiting` (nếu chờ) rồi `room.run_finished` cho mọi thành viên hiện tại. */
export function runClosedEvents(s: RunClosed, memberIds: readonly string[]): UserEvent[] {
  const userIds = [...new Set(memberIds)];
  if (userIds.length === 0) return [];
  const base = { room_id: s.roomId, run_id: s.runId, flow_id: s.flowId };
  const out: UserEvent[] = [];
  if (s.waitKind)
    out.push({
      userIds,
      event: "room.run_waiting",
      data: { ...base, caller_id: s.callerId, kind: s.waitKind },
    });
  out.push({
    userIds,
    event: "room.run_finished",
    data: { ...base, status: s.status, message_id: s.messageId },
  });
  return out;
}

/** D3 · `room.message` tin agent theo người nhận: người gọi bản riêng, người khác bản công khai; `room.unread` từng người. */
export function agentMessageEvents(
  roomId: string,
  msg: { public: RoomMessage; caller: RoomMessage; callerId: string },
  fanout: readonly FanoutRow[],
): UserEvent[] {
  const mine = fanout.filter((f) => f.user_id === msg.callerId);
  const others = fanout.filter((f) => f.user_id !== msg.callerId);
  return [...messageEvents(roomId, msg.public, others), ...messageEvents(roomId, msg.caller, mine)];
}
