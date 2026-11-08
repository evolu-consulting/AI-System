// CR-125 · UX-S7 (H7) · `/admin/tenants/:tenant_id/partner-confirm`:
//   GET — danh sách điều kiện Đối tác xác nhận (platform_admin hoặc quản trị CHÍNH công ty; tenant khác ⇒ 404).
//   PUT {on} — bật/tắt tính năng (CHỈ platform_admin; tenant_admin ⇒ 403, kể cả công ty của mình).
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson } from "../../lib/http";
import { requireTenantScope } from "../../lib/tenant-scope";
import type { TestHooks } from "../../lib/test-hooks";
import type { Call } from "../features/features.service";
import { readPartnerConfirm, setPartnerConfirm } from "./partner-confirm.service";

const Body = z.strictObject({ on: z.boolean() });
const P = "/:tenant_id/partner-confirm";

export function partnerConfirmRoutes(
  d: AuthDeps & { hooks?: TestHooks; hubUrl?: string | undefined },
): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
  });
  const hub = (c: Context<AppVars>) => ({
    url: d.hubUrl,
    bearer: c.req.header("authorization"),
  });
  r.get(P, requireAuth(d), requireRole("platform_admin", "tenant_admin"), async (c) => {
    const id = parseIdParam(c, "tenant_id");
    requireTenantScope(c, id);
    return c.json(await readPartnerConfirm(call(c), id, hub(c)));
  });
  r.put(P, requireAuth(d), requireRole("platform_admin"), async (c) => {
    const b = await parseJson(c, Body);
    return c.json(await setPartnerConfirm(call(c), parseIdParam(c, "tenant_id"), b.on, hub(c)));
  });
  return r;
}
