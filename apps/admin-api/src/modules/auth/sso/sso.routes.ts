// sso-switch · `POST /auth/sso/code` (Bearer: phiên web nguồn) và `POST /auth/sso/redeem` (web đích, `X-App` bắt buộc,
// chỉ client web: phiên mới ⇒ cookie `ai_rt_<app>` HttpOnly, body TokenGrant không kèm refresh token).
import { SsoCodeRequestSchema, SsoRedeemRequestSchema } from "@ai/contracts";
import { Hono } from "hono";
import { type AuthDeps, authenticate } from "../../../lib/auth-middleware";
import { clientIp } from "../../../lib/client-ip";
import { setRefreshCookie } from "../../../lib/cookie";
import { appError } from "../../../lib/errors";
import { clientKind, parseJson, webApp } from "../../../lib/http";
import { issueSsoCode, redeemSsoCode, type SsoCtx } from "./sso.service";

export type SsoRouteDeps = SsoCtx & AuthDeps & { secureCookie: boolean; trustProxyHops?: number };

export function ssoRoutes(d: SsoRouteDeps): Hono {
  const r = new Hono();

  r.post("/sso/code", async (c) => {
    const actor = await authenticate(c, d);
    const { app } = await parseJson(c, SsoCodeRequestSchema);
    return c.json(await issueSsoCode(d, actor, app));
  });

  r.post("/sso/redeem", async (c) => {
    if (clientKind(c) !== "web") throw appError("UNAUTHORIZED");
    const input = await parseJson(c, SsoRedeemRequestSchema);
    const app = webApp(c);
    const s = await redeemSsoCode(
      d,
      { code: input.code, app, tenantKey: input.tenant_key },
      {
        client: "web",
        userAgent: c.req.header("user-agent") ?? null,
        ip: clientIp(c, d.trustProxyHops ?? 0),
      },
    );
    setRefreshCookie(c, s.refreshToken, d.secureCookie, app);
    return c.json(s.grant);
  });

  return r;
}
