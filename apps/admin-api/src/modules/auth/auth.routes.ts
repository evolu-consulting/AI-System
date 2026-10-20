// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-06 Â· /auth/login, /refresh, /logout, /change-password (spec M1 Â§3).
// Web: refresh token chá»‰ á»Ÿ cookie `ai_rt` (CR-053: `ai_rt_<app>` theo `X-App` â€” má»—i app má»™t phiÃªn); extension
// (`X-Client: extension`): chá»‰ á»Ÿ body.
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
  type TokenGrant,
  TotpVerifyRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { clientIp } from "../../lib/client-ip";
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
import { checkIp } from "./limit/limit.service";
import type { TotpCtx } from "./totp/totp.service";
import { verifyTotpLogin } from "./totp/totp.verify";

export type SelfChangeInput = { current_password: string; new_password: string };

export type AuthRouteDeps = TotpCtx & {
  secureCookie: boolean;
  /** Tá»± Ä‘á»•i máº­t kháº©u (cáº§n Bearer) â€” gáº¯n á»Ÿ auth.me.routes Ä‘á»ƒ route nÃ y khÃ´ng phá»¥ thuá»™c middleware. */
  selfChange?: (c: Context, input: SelfChangeInput) => Promise<Response>;
  /** L1 (#224): sá»‘ proxy tin cáº­y trÆ°á»›c app (`TRUST_PROXY_HOPS`); 0/váº¯ng â‡’ IP socket, bá» qua X-Forwarded-For. */
  trustProxyHops?: number;
};

/** Káº¿t quáº£ login / bÆ°á»›c 2FA: nhÃ¡nh chÆ°a cÃ³ phiÃªn tráº£ body nguyÃªn; phiÃªn â†’ cookie (web) hoáº·c body (extension). */
function loginBody(c: Context, res: LoginResult, client: ClientKind, secure: boolean) {
  if (res.kind === "change" || res.kind === "totp") return res.body;
  return sessionBody(c, res, client, secure);
}

function sessionBody(c: Context, s: Session, client: ClientKind, secure: boolean): TokenGrant {
  if (client === "extension") return { ...s.grant, refresh_token: s.refreshToken };
  setRefreshCookie(c, s.refreshToken, secure, webApp(c));
  return s.grant;
}

/** Extension: refresh_token trong body (bá» qua cookie); web: chá»‰ cookie (bá» qua body). Body há»ng = khÃ´ng cÃ³ token. */
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

const metaOf = (c: Context, d: AuthRouteDeps): ClientMeta => ({
  client: clientKind(c),
  userAgent: c.req.header("user-agent") ?? null,
  ip: clientIp(c, d.trustProxyHops ?? 0),
});

/** L1: endpoint kiá»ƒm OTP/máº­t kháº©u ngoÃ i login â€” chá»‰ giá»›i háº¡n IP (khoÃ¡ tÃ i khoáº£n do bá»™ Ä‘áº¿m DB M1/M4). */
async function ipGate(c: Context, d: AuthRouteDeps): Promise<void> {
  if (d.limiter) await checkIp(d.limiter, clientIp(c, d.trustProxyHops ?? 0), d.now());
}

/** POST /refresh: chá»‰ INVALID_REFRESH_TOKEN xoÃ¡ cookie; REFRESH_SUPERSEDED khÃ´ng Set-Cookie (tab tháº¯ng vá»«a Ä‘áº·t cookie má»›i). */
async function refreshRoute(c: Context, d: AuthRouteDeps): Promise<Response> {
  const m = metaOf(c, d);
  try {
    const s = await refresh(d, await tokenFrom(c, m.client), m);
    return c.json(sessionBody(c, s, m.client, d.secureCookie));
  } catch (err) {
    if (!isAppError(err, "INVALID_REFRESH_TOKEN") || m.client !== "web") throw err;
    clearRefreshCookie(c, d.secureCookie, webApp(c));
    return c.json(toErrorBody(err.code, err.message), err.status);
  }
}

export function authRoutes(d: AuthRouteDeps): Hono {
  const r = new Hono();
  const meta = (c: Context) => metaOf(c, d);

  r.post("/login", async (c) => {
    const input = await parseJson(c, LoginRequestSchema);
    const m = meta(c);
    return c.json(loginBody(c, await login(d, input, m), m.client, d.secureCookie));
  });

  // BÆ°á»›c 2 Ä‘Äƒng nháº­p (M4, plan-cd Â§4.2): khÃ´ng cáº§n Bearer; Ä‘Äƒng kÃ½ á»Ÿ Ä‘Ã¢y vÃ¬ dÃ¹ng chung cookie/body nhÆ° login.
  r.post("/totp/verify", async (c) => {
    await ipGate(c, d);
    const input = await parseJson(c, TotpVerifyRequestSchema);
    const m = meta(c);
    return c.json(loginBody(c, await verifyTotpLogin(d, input, m), m.client, d.secureCookie));
  });

  r.post("/refresh", (c) => refreshRoute(c, d));

  r.post("/logout", async (c) => {
    const client = clientKind(c);
    await logout(d, await tokenFrom(c, client, true));
    if (client === "web") clearRefreshCookie(c, d.secureCookie, webApp(c));
    return c.body(null, 204);
  });

  r.post("/change-password", async (c) => {
    await ipGate(c, d);
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
