// CHAT-AC-01..04, CHAT-AC-31 · `/auth/*` (E1–E3) đúng dạng Admin + middleware Bearer của kênh chat (plan C1 §2.4, §3.4, Q-401).
import {
  ACCESS_TOKEN_EXPIRES_IN,
  API_ERRORS,
  LoginRequestSchema,
  LogoutRequestSchema,
  REFRESH_COOKIE,
  RefreshRequestSchema,
  type TokenGrant,
  X_CLIENT_EXTENSION,
  X_CLIENT_HEADER,
} from "@ai/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { type Issue, type Parsed, parseBody } from "./http";
import type { AccessClaims, SessionStore } from "./sessions";
import { findUser, findUserById, MOCK_DEV_PASSWORD, toMe } from "./users";

export type ChatVars = { Variables: { claims: AccessClaims } };

type AuthCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "INVALID_REFRESH_TOKEN"
  | "REFRESH_SUPERSEDED"
  | "ACCOUNT_LOCKED";

// Câu chữ giống admin-api (`lib/errors.ts`).
const MESSAGES: Record<AuthCode, string> = {
  VALIDATION_ERROR: "Invalid request",
  INVALID_CREDENTIALS: "Invalid company code, username or password",
  INVALID_REFRESH_TOKEN: "Invalid refresh token",
  REFRESH_SUPERSEDED: "Refresh token was just rotated",
  ACCOUNT_LOCKED: "Account is locked",
};

const COOKIE_OPTS = { httpOnly: true, sameSite: "Strict", path: "/auth" } as const;
const COOKIE_MAX_AGE_S = 2_592_000;

function authError(c: Context, code: AuthCode, issues?: Issue[]): Response {
  const details = issues ? { details: { issues } } : {};
  return c.json({ error: { code, message: MESSAGES[code], ...details } }, API_ERRORS[code]);
}

const isExtension = (c: Context) => c.req.header(X_CLIENT_HEADER) === X_CLIENT_EXTENSION;

/** Cấp TokenGrant: web nhận cookie `ai_rt`, extension nhận `refresh_token` trong body. */
async function grant(
  c: Context,
  store: SessionStore,
  g: { sid: string; userId: string; refreshToken: string },
): Promise<Response> {
  const u = findUserById(g.userId);
  if (!u) return authError(c, "INVALID_REFRESH_TOKEN");
  const body: TokenGrant = {
    status: "authenticated",
    access_token: await store.signAccess(g.sid),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRES_IN,
    user: toMe(u),
  };
  if (isExtension(c)) return c.json({ ...body, refresh_token: g.refreshToken });
  setCookie(c, REFRESH_COOKIE, g.refreshToken, { ...COOKIE_OPTS, maxAge: COOKIE_MAX_AGE_S });
  return c.json(body);
}

/** Refresh token của request: extension → body, web → cookie. */
async function readRefreshToken(c: Context): Promise<Parsed<string | undefined>> {
  if (!isExtension(c)) return { ok: true, data: getCookie(c, REFRESH_COOKIE) };
  const r = await parseBody(c, RefreshRequestSchema);
  return r.ok ? { ok: true, data: r.data.refresh_token } : r;
}

export function createAuthRoutes(store: SessionStore): Hono {
  const app = new Hono();

  app.post("/auth/login", async (c) => {
    const r = await parseBody(c, LoginRequestSchema);
    if (!r.ok) return authError(c, "VALIDATION_ERROR", r.issues);
    const u = findUser(r.data.tenant_key, r.data.username);
    if (!u || r.data.password !== MOCK_DEV_PASSWORD) return authError(c, "INVALID_CREDENTIALS");
    if (u.locked) return authError(c, "ACCOUNT_LOCKED");
    const s = store.open(u.id, u.tenant.id);
    return grant(c, store, { ...s, userId: u.id });
  });

  app.post("/auth/refresh", async (c) => {
    const t = await readRefreshToken(c);
    if (!t.ok) return authError(c, "VALIDATION_ERROR", t.issues);
    const r = t.data ? store.rotate(t.data) : null;
    if (r?.ok) return grant(c, store, r);
    const code = r?.code ?? "INVALID_REFRESH_TOKEN";
    // Như Admin: chỉ INVALID_REFRESH_TOKEN của web xoá cookie (SUPERSEDED: tab thắng vừa đặt cookie mới).
    if (code === "INVALID_REFRESH_TOKEN" && !isExtension(c))
      deleteCookie(c, REFRESH_COOKIE, COOKIE_OPTS);
    return authError(c, code);
  });

  app.post("/auth/logout", async (c) => {
    const r = await parseBody(c, LogoutRequestSchema);
    const token = (r.ok ? r.data.refresh_token : undefined) ?? getCookie(c, REFRESH_COOKIE);
    if (token) store.revoke(token);
    if (!isExtension(c)) deleteCookie(c, REFRESH_COOKIE, COOKIE_OPTS);
    return c.body(null, 204);
  });

  return app;
}

const BEARER_RE = /^bearer\s+(\S+)\s*$/i;

/** Endpoint Hub: token thiếu/sai/hết hạn/bị thu hồi → 401 `AUTH_EXPIRED` (Q-401). */
export function requireAccess(store: SessionStore) {
  return createMiddleware<ChatVars>(async (c, next) => {
    const token = BEARER_RE.exec(c.req.header("Authorization") ?? "")?.[1];
    const claims = token ? await store.verifyAccess(token) : null;
    if (!claims) {
      const error = { code: "AUTH_EXPIRED", message: "Access token expired or invalid" };
      return c.json({ error }, 401);
    }
    c.set("claims", claims);
    await next();
  });
}
