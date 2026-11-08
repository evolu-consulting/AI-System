// CR-125 · c5b · `/admin/tenants/:tenant_id/template-fixes/*` — chỉ platform_admin (không token ⇒ 401, sai vai ⇒ 403).
// enable-feature {flow_id, feature_key} (chỉ khi mẫu đang thiếu đúng tính năng đó, hỏi Hub): bật tính năng cho công ty · create-group {group_key}: tạo nhóm theo gợi ý. Tenant lấy từ đường dẫn (không từ body).
import { GroupKeySchema } from "@ai/contracts/groups";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import {
  createSuggestedGroup,
  enableFeatureForTemplate,
  type FixCall,
  readinessFromHub,
} from "./template-fixes.service";

const FeatureBody = z.strictObject({
  flow_id: z.uuid(),
  feature_key: z.string().trim().min(1).max(64),
});
const GroupBody = z.strictObject({ group_key: GroupKeySchema });
const P = "/:tenant_id/template-fixes";

export function templateFixesRoutes(
  d: AuthDeps & { hooks?: TestHooks; hubUrl?: string | undefined },
): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use(`${P}/*`, requireAuth(d), requireRole("platform_admin"));
  const call = (c: Context<AppVars>): FixCall => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
  });
  r.post(`${P}/enable-feature`, async (c) => {
    const b = await parseJson(c, FeatureBody);
    const tenantId = parseIdParam(c, "tenant_id");
    const readiness = await readinessFromHub(
      d.hubUrl,
      c.req.header("authorization"),
      tenantId,
      b.flow_id,
    );
    return c.json(
      await enableFeatureForTemplate(call(c), {
        tenantId,
        flowId: b.flow_id,
        featureKey: b.feature_key,
        readiness,
      }),
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
