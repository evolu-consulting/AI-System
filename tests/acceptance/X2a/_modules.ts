// HUB-FR-96 · HUB-FR-99 · HUB-FR-102 · nạp động module sản phẩm X2a (mẫu X1 `_modules.ts`, test-plan X2a §5.1): test viết
// TRƯỚC code ⇒ import tĩnh file chưa có làm vỡ `bun run typecheck`. Import động theo chuỗi → kiểu lỏng, ca đỏ lúc chạy
// ("Cannot find module"/thiếu export) tới khi task B2/B3/B7 xong. Chỉ dùng chữ ký ở plan.md §2, §8. Không DB/env.
import { join } from "node:path";
import { type Loose, ROOT } from "../M1/_modules";

export { type Loose, ROOT };

const load = (rel: string): Promise<Loose> => import(join(ROOT, rel));

/** plan §8: `dmKey`, `roomActionError`, `planCreateGroup`, `planAddMembers`, `leaveOutcome`, `clampReadSeq`, `unreadOf`,
 * `previewOf`, `joinReadSeq`, `encodeRoomCursor`, `decodeRoomCursor`. */
export const loadRoomsRules = () => load("apps/hub-api/src/modules/rooms/rooms.rules.ts");
/** plan §8: `messageEvents`, `readEvents`, `memberRemovedEvents` (+ 3 hàm khác) → `UserEvent[]` (`{userIds, event, data}`). */
export const loadRoomEvents = () => load("apps/hub-api/src/modules/rooms/room-events.ts");
/** plan §8: `parseStreamId`, `resumeDecision`, `evictOldest`. */
export const loadMeStreamRules = () =>
  load("apps/hub-api/src/modules/me-stream/me-stream.rules.ts");
/** plan §8: `likePattern`. */
export const loadDirectoryRules = () =>
  load("apps/hub-api/src/modules/directory/directory.rules.ts");
/** plan §2: `@ai/contracts/chat` (khối X2a chỉ thêm). */
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");
