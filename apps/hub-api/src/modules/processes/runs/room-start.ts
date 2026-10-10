// HUB-FR-105 · HUB-FR-113 · T1 · PF1 · `!key` ở timeline phòng: tin gọi user + run + outbox `block` (một tx, khoá §10);
// trùng `client_msg_id` ⇒ tin cũ, không tạo run; lỗi (404/429) ⇒ ROLLBACK (không lưu tin). Thân ở `StartService`.
import type { RoomProcessSender } from "../../rooms/messages/messages.service";
import type { ProcessDeps } from "../core/ports";
import { StartService } from "./start.service";

export function roomStart(d: ProcessDeps): RoomProcessSender {
  const svc = new StartService(d);
  return {
    start: (u, roomId, body, bang) => svc.fromRoomMessage(u, roomId, body, bang),
  };
}
