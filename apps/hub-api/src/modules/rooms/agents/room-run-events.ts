// HUB-FR-99 · HUB-FR-101 · X2b sự kiện run phòng qua `/me/stream` (plan §7, D10). Thuần: người nhận tính TRONG tx gọi (dưới
// khoá `rooms`), phát qua `publishUserEvents` SAU commit. Không nội dung tin / tham số (R12).
import type { RoomAgentRef, RoomMessage } from "@ai/contracts/chat";
import type { UserEvent } from "../../../lib/user-stream";

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
