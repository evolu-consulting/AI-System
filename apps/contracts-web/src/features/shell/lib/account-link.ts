// GAP-E #32 · đổi mật khẩu / 2FA dùng lại trang của nền tảng (admin-web `/account/password`, `/account/2fa`) qua SSO một lần —
// như app switcher: xin mã ở admin-api (URL đích lấy từ catalog), chuyển sang `<admin>/sso#code=…&next=<trang>`.
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { api } from "@ai/web-kit/http";
import { session } from "~/features/auth/lib/session";
import { FALLBACK_URLS } from "./fallback-urls";

export const ADMIN_APP_KEY = "admin";
export const ACCOUNT_PAGES = {
  password: "/account/password",
  twofa: "/account/2fa",
} as const;
export type AccountPage = keyof typeof ACCOUNT_PAGES;

/** URL đích; `null` khi không xin được mã và cũng không có URL dự phòng. */
export function accountPageUrl(page: AccountPage): Promise<string | null> {
  return handOffUrl({
    authed: true,
    grant: () => session.ssoGrant(ADMIN_APP_KEY),
    fallbackBase: FALLBACK_URLS[ADMIN_APP_KEY],
    next: ACCOUNT_PAGES[page],
  });
}

/** Đổi ngôn ngữ ở server (best-effort: lỗi mạng không chặn đổi ngôn ngữ giao diện). */
export function saveMyLocale(locale: string): Promise<unknown> {
  return api("/auth/me", { method: "PATCH", body: { locale } }).catch(() => null);
}
