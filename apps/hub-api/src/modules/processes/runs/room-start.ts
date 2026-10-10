// HUB-FR-105 · HUB-FR-113 · T1 · PF1 · `!key` ở timeline phòng: một tx (khoá phòng → trùng `client_msg_id` ⇒ 200 →
// tạo run → chèn tin gọi TRƯỚC khi đặt `process_runs.trigger_message_id` → outbox `block`). Bước 0: 404 `PROCESS_NOT_FOUND`.
import type { RoomProcessSender } from "../../rooms/messages/messages.service";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";

export function roomStart(_d: ProcessDeps): RoomProcessSender {
  return {
    start: async () => {
      throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    },
  };
}
