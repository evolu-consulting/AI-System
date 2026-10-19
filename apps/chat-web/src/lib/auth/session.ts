// CHAT-AC-01, CHAT-AC-03 · phiên của chat-web: cấu hình phiên dùng chung `@ai/web-kit` (N1 TF3).
// Tên kênh/khoá riêng của chat (không tranh với Admin); phiên kết thúc → xoá nháp ô nhập (review C1 #2).
import { createSession } from "@ai/web-kit/auth/session";
import { DRAFT_KEY_PREFIX, removeLocalByPrefix } from "../storage";

/** CR-053 · `X-App` khi gọi `/auth/*` ⇒ admin-api dùng cookie phiên riêng `ai_rt_chat`. */
export const CHAT_APP = "chat";
export const AUTH_CHANNEL_NAME = "ai-chat-auth";
export const REFRESH_LOCK_NAME = "ai-chat-refresh";

export const session = createSession({
  app: CHAT_APP,
  channelName: AUTH_CHANNEL_NAME,
  lockName: REFRESH_LOCK_NAME,
  onEnd: () => removeLocalByPrefix(DRAFT_KEY_PREFIX),
});
