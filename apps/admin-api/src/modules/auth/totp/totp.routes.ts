// ADM-FR-08 · M4-AC11 · M4-AC12 · /auth/totp/{setup,enable,disable,backup-codes} (plan-cd §4.2). Bearer + chỉ
// platform_admin/tenant_admin (member → 403). Phản hồi chứa secret/mã → `Cache-Control: no-store`.
import {
  TotpBackupCodesRequestSchema,
  TotpDisableRequestSchema,
  TotpEnableRequestSchema,
  TotpSetupRequestSchema,
} from "@ai/contracts";
import { Hono, type MiddlewareHandler } from "hono";
import {
  type AppVars,
  type AuthDeps,
  requireAuth,
  requireRole,
} from "../../../lib/auth-middleware";
import { parseJson } from "../../../lib/http";
import {
  disableTotp,
  enableTotp,
  regenerateBackupCodes,
  setupTotp,
  type TotpCtx,
} from "./totp.service";

const noStore: MiddlewareHandler<AppVars> = async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
};

export function totpRoutes(d: TotpCtx & AuthDeps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const guard = [requireAuth(d), requireRole("platform_admin", "tenant_admin"), noStore] as const;
  r.post("/setup", ...guard, async (c) => {
    const { current_password } = await parseJson(c, TotpSetupRequestSchema);
    return c.json(await setupTotp(d, c.get("actor"), current_password));
  });
  r.post("/enable", ...guard, async (c) => {
    const { code } = await parseJson(c, TotpEnableRequestSchema);
    return c.json(await enableTotp(d, c.get("actor"), code));
  });
  r.post("/disable", ...guard, async (c) => {
    const body = await parseJson(c, TotpDisableRequestSchema);
    await disableTotp(d, c.get("actor"), body);
    return c.body(null, 204);
  });
  r.post("/backup-codes", ...guard, async (c) => {
    const { code } = await parseJson(c, TotpBackupCodesRequestSchema);
    return c.json(await regenerateBackupCodes(d, c.get("actor"), code));
  });
  return r;
}
