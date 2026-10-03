// CHAT-AC-34, CHAT-AC-36 · cổng bật ca phụ thuộc apps/chat-web (test-plan C1 §9).
// Chỉ chạy khi `C1_STRICT=1` (Lệnh xong task F/QV của C1) để `bun test` gốc của phiên M4 không đỏ khi C1 đang làm dở.
// Điều phối đổi 2026-10-04 (trước: bật khi có apps/chat-web).
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../..");
export const CHAT_WEB = join(ROOT, "apps/chat-web");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến chỉ của test, không ảnh hưởng cache turbo
export const STRICT = Bun.env.C1_STRICT === "1";
export const CHAT_WEB_ENABLED = STRICT;
