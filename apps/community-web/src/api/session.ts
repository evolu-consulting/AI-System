// CR-102 · C3 · phiên community-web: app `community` trong `WEB_APPS` ⇒ admin-api dùng cookie refresh riêng `ai_rt_community`
// (Path=/auth). Đăng nhập chung qua AI System (sso-switch, như contracts-web): chưa có phiên ⇒ dội sang
// `<PUBLIC_SSO_URL>/sso?app=community`, AI System trả về `/sso#code=…` ⇒ đổi mã lấy phiên. Đối tác (user ngoài) chỉ được
// cấp mã cho app `community` (C2 `EXTERNAL_APPS`).
import { createSession } from "@ai/web-kit/auth/session";
import { parseSsoFragment, shouldTrySso, ssoStartUrl } from "@ai/web-kit/auth/sso";

export const COMMUNITY_APP = "community";

export const session = createSession({
  app: COMMUNITY_APP,
  channelName: "ai-community-auth",
  lockName: "ai-community-refresh",
});

export const SSO_URL = (import.meta.env.PUBLIC_SSO_URL ?? "").trim().replace(/\/+$/, "");
const TRIED_KEY = "community:sso_tried_at";

function triedAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem(TRIED_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return Date.now(); // storage bị chặn ⇒ coi như vừa thử (không dội vòng)
  }
}

/** Dội sang AI System nếu cấu hình và chưa thử gần đây; true = đã chuyển trang. */
export function bounceToSso(next: string): boolean {
  if (!SSO_URL || !shouldTrySso(triedAt(), Date.now())) return false;
  try {
    sessionStorage.setItem(TRIED_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.assign(ssoStartUrl(SSO_URL, COMMUNITY_APP, next));
  return true;
}

/** Trang `/sso#code=…`: đổi mã lấy phiên, trả `next` (đường dẫn cùng origin). Không phải trang SSO ⇒ null. */
export async function redeemFromLocation(): Promise<string | null> {
  if (location.pathname !== "/sso") return null;
  const { code, next } = parseSsoFragment(location.hash);
  if (code) await session.ssoRedeem(code);
  return next;
}
