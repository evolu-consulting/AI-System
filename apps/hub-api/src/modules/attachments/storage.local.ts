// HUB-FR-44 · H2c-R04, AC-15 · L8, P23 · driver `local` của `AttachmentStorage` (plan-rules §4).
// B0: chỉ chữ ký (thân ném `not implemented`) — B1.
import type { AttachmentStorage } from "./storage";

/** Tạo `dir` nếu thiếu (0700 khi không `win32`), ghi thử; lỗi ⇒ ném (server thoát ≠ 0). */
export function createLocalStorage(_o: {
  dir: string;
  platform?: NodeJS.Platform;
}): Promise<AttachmentStorage> {
  throw new Error("not implemented: createLocalStorage");
}
