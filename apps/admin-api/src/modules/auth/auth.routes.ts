// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-06 · /auth/login, /refresh, /logout, /change-password (spec M1 §3).
// Web: refresh token chỉ ở cookie `ai_rt` (CR-053: `ai_rt_<app>` theo `X-App` — mỗi app một phiên); extension
// (`X-Client: extension`): chỉ ở body.
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
  type TokenGrant,
  TotpVerifyRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../../lib/cookie";
import { appError, isAppError, toErrorBody } from "../../lib/errors";
import { type ClientKind, clientKind, parseJson, readJson, webApp } from "../../lib/http";
import {
  type ClientMeta,
  changePasswordForced,
  type LoginResult,
  login,
  logout,
  refresh,
  type Session,
} from "./auth.service";
import type { TotpCtx } from "./totp/totp.service";
import { verifyTotpLogin } from "./totp/totp.verify";

export type SelfChangeInput = { current_password: string; new_password: string };

export type AuthRouteDeps = TotpCtx & {
  secureCookie: boolean;
  /** Tự đổi mật khẩu (cần Bearer) — gắn ở auth.me.routes để route này không phụ thuộc middleware. */
  selfChange?: (c: Context, input: SelfChangeInput) => Promise<Response>;
};

const meta = (c: Context): ClientMeta => ({
  client: clientKind(c),
  userAgent: c.req.header("user-agent") ?? null,
});

/** Kết quả login / bước 2FA: nhánh chưa có phiên trả body nguyên; phiên → cookie (web) hoặc body (extension). */
function loginBody(c: Context, res: LoginResult, client: ClientKind, secure: boolean) {
  if (res.kind === "change" || res.kind === "totp") return res.body;
  return sessionBody(c, res, client, secure);
}

function sessionBody(c: Context, s: Session, client: ClientKind, secure: boolean): TokenGrant {
  if (client === "extension") return { ...s.grant, refresh_token: s.refreshToken };
  setRefreshCookie(c, s.refreshToken, secure, webApp(c));
  return s.grant;
}

/** Extension: refresh_token trong body (bỏ qua cookie); web: chỉ cookie (bỏ qua body). Body hỏng = không có token. */
async function tokenFrom(
  c: Context,
  client: ClientKind,
  logoutForm = false,
): Promise<string | undefined> {
  if (client === "web") return readRefreshCookie(c, webApp(c));
  const body = await readJson(c).catch(() => undefined);
  const r = (logoutForm ? LogoutRequestSchema : RefreshRequestSchema).safeParse(body);
  return r.success ? r.data.refresh_token : undefined;
}

export function authRoutes(d: AuthRouteDeps): Hono {
  const r = new Hono();

  r.post("/login", async (c) => {
    const input = await parseJson(c, LoginRequestSchema);
    const m = meta(c);
    return c.json(loginBody(c, await login(d, input, m), m.client, d.secureCookie));
  });

  // Bước 2 đăng nhập (M4, plan-cd §4.2): không cần Bearer; đăng ký ở đây vì dùng chung cookie/body như login.
  r.post("/totp/verify", async (c) => {
    const input = await parseJson(c, TotpVerifyRequestSchema);
    const m = meta(c);
    return c.json(loginBody(c, await verifyTotpLogin(d, input, m), m.client, d.secureCookie));
  });

  r.post("/refresh", async (c) => {
    const m = meta(c);
    try {
      const s = await refresh(d, await tokenFrom(c, m.client), m);
      return c.json(sessionBody(c, s, m.client, d.secureCookie));
    } catch (err) {
      // Chỉ INVALID_REFRESH_TOKEN xoá cookie; REFRESH_SUPERSEDED không Set-Cookie (tab thắng vừa đặt cookie mới).
      if (!isAppError(err, "INVALID_REFRESH_TOKEN") || m.client !== "web") throw err;
      clearRefreshCookie(c, d.secureCookie, webApp(c));
      return c.json(toErrorBody(err.code, err.message), err.status);
    }
  });

  r.post("/logout", async (c) => {
    const client = clientKind(c);
    await logout(d, await tokenFrom(c, client, true));
    if (client === "web") clearRefreshCookie(c, d.secureCookie, webApp(c));
    return c.body(null, 204);
  });

  r.post("/change-password", async (c) => {
    const input = await parseJson(c, ChangePasswordRequestSchema);
    if ("current_password" in input) {
      if (!d.selfChange) throw appError("UNAUTHORIZED");
      return d.selfChange(c, input);
    }
    const m = meta(c);
    const s = await changePasswordForced(d, input, m);
    return c.json(sessionBody(c, s, m.client, d.secureCookie));
  });

  return r;
}
