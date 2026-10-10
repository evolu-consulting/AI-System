// HUB-FR-105 · D14 · PF1 · `!key` ở Hỏi AI ⇒ 202 `{process_run}` (plan-contract §3). Bước 0: chưa có quy trình nào chạy
// được ⇒ 404 `PROCESS_NOT_FOUND` (cờ bật mới tới đây; cờ tắt `!` là chữ thường).
import { processError } from "../core/errors";
import type { ProcessDeps, ProcessStartPort } from "../core/ports";

export function conversationStart(_d: ProcessDeps): ProcessStartPort {
  return {
    fromConversation: async () => {
      throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    },
  };
}
