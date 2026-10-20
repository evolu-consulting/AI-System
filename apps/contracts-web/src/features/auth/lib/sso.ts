// sso-switch · contracts-web dùng chung đăng nhập AI System (chat-web, `PUBLIC_SSO_URL`): chưa có phiên ⇒ dội sang
// `<AI System>/sso?app=contracts` (một lần mỗi phút mỗi tab, chống vòng); AI System trả về `/sso#code=…` ⇒ đổi mã lấy phiên.
import { shouldTrySso, ssoStartUrl } from "@ai/web-kit/auth/sso";

export const SSO_URL = (import.meta.env.PUBLIC_SSO_URL ?? "").trim().replace(/\/+$/, "");
const TRIED_KEY = "contracts:sso_tried_at";

function triedAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem(TRIED_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return Date.now(); // storage bị chặn ⇒ coi như vừa thử (không dội để khỏi vòng)
  }
}

/** Dội sang AI System nếu được cấu hình và chưa thử gần đây; true = đã chuyển trang (người gọi dừng). */
export function bounceToSso(nextHref: string): boolean {
  if (!SSO_URL || !shouldTrySso(triedAt(), Date.now())) return false;
  try {
    sessionStorage.setItem(TRIED_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.assign(ssoStartUrl(SSO_URL, "contracts", nextHref));
  return true;
}
