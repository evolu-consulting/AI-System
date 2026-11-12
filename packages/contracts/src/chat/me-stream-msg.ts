// CR-132 M4 · sự kiện `msg.*` của `/me/stream`: định nghĩa ở `pack-contracts/messages.ts` (cùng contract tin nhắn); re-export ở đây để hub-core (lib/user-stream,
// chat-gate, me-stream) lấy cùng chỗ với `process.*`/`esign.updated` (`@ai/contracts/chat`).
export {
  ME_STREAM_MSG_EVENTS,
  type MeStreamMsgEvent,
  type MeStreamMsgEventName,
  MeStreamMsgEventSchema,
  parseMeStreamMsgEvent,
} from "../pack-contracts/messages";
