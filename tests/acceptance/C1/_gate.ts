// CHAT-AC-34, CHAT-AC-36 · cổng bật ca phụ thuộc apps/chat-web (test-plan C1 §9).
// chat-web do F1 tạo sau QA; chưa có thì ca quét file bị tắt để không làm đỏ `bun test` gốc (phiên khác).
// `C1_STRICT=1` ép chạy (CI/verify và lần kiểm "đỏ đúng lý do"): thiếu thư mục là đỏ.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../..");
export const CHAT_WEB = join(ROOT, "apps/chat-web");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến chỉ của test, không ảnh hưởng cache turbo
export const STRICT = Bun.env.C1_STRICT === "1";
export const CHAT_WEB_ENABLED = STRICT || existsSync(CHAT_WEB);
