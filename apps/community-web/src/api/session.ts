// CR-102 · C3 · phiên community-web: app `community` trong `WEB_APPS` ⇒ admin-api dùng cookie refresh riêng `ai_rt_community`
// (Path=/auth). com-fix-community-login: đăng nhập trên màn riêng của community-web (`api/auth.ts`, như contracts-web) — đối tác
// không cần chat-web. Nội bộ đã có phiên AI System: link SSO ⇒ `<PUBLIC_SSO_URL>/sso?app=community&login=1` ⇒ AI System trả về
// `/sso#code=…` (đích lấy từ catalog) ⇒ đổi mã lấy phiên.
import { createSession } from "@ai/web-kit/auth/session";
import { parseSsoFragment } from "@ai/web-kit/auth/sso";

export const COMMUNITY_APP = "community";

export const session = createSession({
  app: COMMUNITY_APP,
  channelName: "ai-community-auth",
  lockName: "ai-community-refresh",
});

export const SSO_URL = (import.meta.env.PUBLIC_SSO_URL ?? "").trim().replace(/\/+$/, "");
/** Trang `/sso#code=…`: đổi mã lấy phiên, trả `next` (đường dẫn cùng origin). Không phải trang SSO ⇒ null. */
export async function redeemFromLocation(): Promise<string | null> {
  if (location.pathname !== "/sso") return null;
  const { code, next } = parseSsoFragment(location.hash);
  if (code) await session.ssoRedeem(code);
  return next;
}
