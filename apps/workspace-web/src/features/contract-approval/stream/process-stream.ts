// CR-107 · eng-card-ui · CR-132 W1: thẻ duyệt / ký số nghe sự kiện quy trình qua bộ phát `/me/stream` DÙNG CHUNG
// (`platform/stream/me-stream.ts`, một kết nối mỗi tab). Ở đây chỉ lọc + parse sự kiện quy trình hợp lệ.
import {
  ME_STREAM_PROCESS_EVENTS,
  type MeStreamProcessEvent,
  parseMeStreamProcessEvent,
} from "@ai/contracts/chat";
import { listenFrames } from "~/platform/stream/me-stream";

export { isFatalStreamError, reconnectDelay } from "~/platform/stream/me-stream";

/**
 * Nghe tới khi `signal` huỷ. `onReconnected` gọi khi kết nối LẠI sau đứt (có thể lỡ sự kiện ⇒ tải lại một lần).
 * Không gửi `Last-Event-ID` (chỉ cần "có gì đổi" ⇒ tải lại thẻ).
 */
export function listenProcessEvents(
  signal: AbortSignal,
  onEvent: (e: MeStreamProcessEvent) => void,
  onReconnected: () => void,
): Promise<void> {
  return listenFrames(
    ME_STREAM_PROCESS_EVENTS,
    signal,
    (f) => {
      const e = parseMeStreamProcessEvent(f.event, f.data);
      if (e) onEvent(e);
    },
    onReconnected,
  );
}
