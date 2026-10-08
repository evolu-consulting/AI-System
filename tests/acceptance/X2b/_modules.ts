// HUB-FR-101 · HUB-FR-103 · nạp động module sản phẩm X2b (mẫu X2a `_modules.ts`): test viết TRƯỚC code ⇒ import tĩnh file
// chưa có làm vỡ `bun run typecheck`. Import động theo chuỗi → kiểu lỏng, ca đỏ lúc chạy (thiếu module/export) tới khi
// task B2/B4 xong. Chỉ dùng chữ ký ở plan.md §2, §8. Không DB/env.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export { type Loose, ROOT };

/** plan §8: `routeRoomMessage`, `canTriggerRun`, `answerAccess`, `roomContext`, `agentMessageView`,
 * `askForViewer`, `callerReadAfterPost`, `shouldPost`, `confirmStillAllowed`. Module chưa có ⇒ `{}`. */
export async function loadRoomAgentRules(): Promise<Loose> {
  try {
    return await import(join(ROOT, "apps/hub-api/src/modules/rooms/agents/room-agent.rules.ts"));
  } catch {
    return {};
  }
}
/** plan §2: `@ai/contracts/chat` (khối X2b chỉ thêm). */
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");
