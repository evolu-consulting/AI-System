// app-catalog · cầu nối cho component (component không import `api.ts` trực tiếp — T-DEP-5): dữ liệu switcher dùng chung.
import type { MeApp } from "@ai/contracts/app-catalog";
import { session } from "@/lib/auth/session";
import { requestSsoGrant } from "../api";
import { appOpenUrl } from "../lib/open-app";

export { fetchMyApps, requestSsoGrant } from "../api";

/**
 * admin-sso-bounce · mở app khác từ một link trong admin-web, chuyển phiên bằng mã một lần (như switcher). `newTab` ⇒ tab mới
 * (trình duyệt chặn popup ⇒ mở ngay tab này).
 */
export async function openApp(app: MeApp, next = "/", newTab = false): Promise<void> {
  const url = await appOpenUrl(app, next, {
    authed: session.getState().status === "authed",
    grant: requestSsoGrant,
  });
  // `noopener` làm `window.open` luôn trả null (không biết bị chặn hay không) ⇒ mở rồi cắt `opener` tay.
  const w = newTab ? window.open(url, "_blank") : null;
  if (w) {
    w.opener = null;
    return;
  }
  window.location.assign(url);
}
