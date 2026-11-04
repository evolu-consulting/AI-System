// PK-FR-10 · TF4 · phiên của contracts-web trên `@ai/web-kit` (D-19): token trong bộ nhớ + cookie refresh + khoá refresh +
// kênh đa tab. Tên kênh/khoá RIÊNG (trùng app khác = tranh khoá / đăng xuất chéo). Phiên kết thúc → xoá cache Query
// (dữ liệu tenant cũ không lộ sang người đăng nhập sau).
import { createSession } from "@ai/web-kit/auth/session";
import { queryClient } from "~/app/query-client";

/** CR-053 · `X-App` khi gọi `/auth/*`. `contracts` nằm trong `WEB_APPS` ⇒ admin-api dùng cookie phiên riêng `ai_rt_contracts`. */
export const CONTRACTS_APP = "contracts";
export const AUTH_CHANNEL_NAME = "ai-contracts-auth";
export const REFRESH_LOCK_NAME = "ai-contracts-refresh";

export const session = createSession({
  app: CONTRACTS_APP,
  channelName: AUTH_CHANNEL_NAME,
  lockName: REFRESH_LOCK_NAME,
  onEnd: () => queryClient.clear(),
});
