// HUB-FR-105 · D14 · ADM-FR-67 · PF1 · `ProcessStartPort`: Hỏi AI `!key` ⇒ 202 `{process_run}` (origin conversation, không
// thread, không lưu tin); nút "Chạy" admin ⇒ origin admin (def đã kiểm ở `DefsService.run`). Thân ở `StartService`.
import type { ProcessDeps, ProcessStartPort } from "../core/ports";
import { StartService } from "./start.service";

export function conversationStart(d: Omit<ProcessDeps, "start">): ProcessStartPort {
  const svc = new StartService(d);
  return {
    fromConversation: (u, conversationId, bang) => svc.fromConversation(u, conversationId, bang),
    fromAdmin: (u, defId, input, inputs) => svc.fromAdmin(u, defId, input, inputs),
  };
}
