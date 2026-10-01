// ADM-FR-02, ADM-NFR-01 · cookie refresh token của web (spec M1 §3): `ai_rt`, HttpOnly, SameSite=Strict, Path=/auth,
// Max-Age 30 ngày, Secure khi production. Extension không bao giờ nhận cookie.
import { REFRESH_COOKIE } from "@ai/contracts";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const MAX_AGE_S = 2_592_000;
const base = (secure: boolean) =>
  ({ httpOnly: true, sameSite: "Strict", path: "/auth", secure }) as const;

export function setRefreshCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, REFRESH_COOKIE, token, { ...base(secure), maxAge: MAX_AGE_S });
}

export function clearRefreshCookie(c: Context, secure: boolean): void {
  setCookie(c, REFRESH_COOKIE, "", { ...base(secure), maxAge: 0 });
}

/** Cookie vắng hoặc rỗng → undefined. */
export function readRefreshCookie(c: Context): string | undefined {
  const v = getCookie(c, REFRESH_COOKIE);
  return v ? v : undefined;
}
