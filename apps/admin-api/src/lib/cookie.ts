// ADM-FR-02, ADM-NFR-01 · cookie refresh token của web (spec M1 §3): `ai_rt`, HttpOnly, SameSite=Strict, Path=/auth,
// Max-Age 30 ngày, Secure khi production. Extension không bao giờ nhận cookie. CR-053: app web báo `X-App` ⇒ cookie
// riêng `ai_rt_<app>` (đăng nhập/đăng xuất một app không ảnh hưởng app khác).
import { refreshCookieName, type WebApp } from "@ai/contracts";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const MAX_AGE_S = 2_592_000;
const base = (secure: boolean) =>
  ({ httpOnly: true, sameSite: "Strict", path: "/auth", secure }) as const;

export function setRefreshCookie(c: Context, token: string, secure: boolean, app?: WebApp): void {
  setCookie(c, refreshCookieName(app), token, { ...base(secure), maxAge: MAX_AGE_S });
}

export function clearRefreshCookie(c: Context, secure: boolean, app?: WebApp): void {
  setCookie(c, refreshCookieName(app), "", { ...base(secure), maxAge: 0 });
}

/** Cookie (của đúng app) vắng hoặc rỗng → undefined. */
export function readRefreshCookie(c: Context, app?: WebApp): string | undefined {
  const v = getCookie(c, refreshCookieName(app));
  return v ? v : undefined;
}
