// CR-125 · c5b · `/admin/tenants/:tenant_id/template-fixes/*` — chỉ platform_admin (không token ⇒ 401, sai vai ⇒ 403).
// enable-feature {feature_key}: bật tính năng cho công ty · create-group {group_key}: tạo nhóm theo gợi ý. Tenant lấy từ đường dẫn (không từ body).
import { GroupKeySchema } from "@ai/contracts/groups";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import {
  createSuggestedGroup,
  enableFeatureForTenant,
  type FixCall,
} from "./template-fixes.service";

const FeatureBody = z.strictObject({ feature_key: z.string().trim().min(1).max(64) });
const GroupBody = z.strictObject({ group_key: GroupKeySchema });
const P = "/:tenant_id/template-fixes";

export function templateFixesRoutes(d: AuthDeps & { hooks?: TestHooks }): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use(`${P}/*`, requireAuth(d), requireRole("platform_admin"));
  const call = (c: Context<AppVars>): FixCall => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
  });
  r.post(`${P}/enable-feature`, async (c) => {
    const b = await parseJson(c, FeatureBody);
    return c.json(
      await enableFeatureForTenant(call(c), parseIdParam(c, "tenant_id"), b.feature_key),
    );
  });
  r.post(`${P}/create-group`, async (c) => {
    const b = await parseJson(c, GroupBody);
    return c.json(
      await createSuggestedGroup(call(c), parseIdParam(c, "tenant_id"), b.group_key),
      201,
    );
  });
  return r;
}
