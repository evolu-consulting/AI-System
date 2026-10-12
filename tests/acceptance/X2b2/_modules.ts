// HUB-FR-44 · HUB-FR-101 · nạp động module sản phẩm X2b-2 (mẫu X2b `_modules.ts`): test viết TRƯỚC code ⇒ import tĩnh file
// chưa có làm vỡ `bun run typecheck`. Import động theo chuỗi → kiểu lỏng; module/export vắng ⇒ `{}` ⇒ ca đỏ ở
// `expect(typeof f).toBe("function")`, không `TypeError` lúc import. Chỉ dùng chữ ký ở plan.md §8. Không DB/env.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export type { Loose };

async function tryLoad(rel: string): Promise<Loose> {
  try {
    return await import(join(ROOT, rel));
  } catch {
    return {};
  }
}

/** plan §8: `pickRoomRunFiles`, `roomFileWindow`, `canReadAttachment`, `isUnbound`, `attachmentRefs`. */
export const loadRoomFilesRules = () =>
  tryLoad("apps/hub-api/src/modules/attachments/room-files.rules.ts");
/** plan §8: `roomFilesAllowed` (D8). */
export const loadRoomsRules = () => tryLoad("apps/hub-api/src/modules/rooms/rooms.rules.ts");
/** plan §8: `shouldBindRoomOutputs` (R11, S6). */
export const loadRoomAgentRules = () =>
  tryLoad("apps/hub-api/src/modules/rooms/agents/room-agent.rules.ts");
/** plan §2: `@ai/contracts/chat` (khối X2b-2 chỉ thêm). */
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");

/** Lấy hàm theo tên; vắng ⇒ đỏ ở `expect(typeof …)`. */
// biome-ignore lint/suspicious/noExplicitAny: module nạp động, kết quả kiểm bằng expect
export type Fn = (...a: any[]) => any;
