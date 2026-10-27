// tenant-quotas · /admin/tenants/:id/daily-limits[/:kind/reset]. Chỉ platform_admin (không token ⇒ 401, sai vai ⇒ 403).
// Middleware gắn theo đường dẫn riêng (không `*`) để không chặn các route `/admin/tenants/*` khác.
import { DailyLimitKindSchema, DailyLimitsPutSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseIdParam, parseJson, parseWith } from "../../lib/http";
import type { TestHooks } from "../../lib/test-hooks";
import type { DailyCounterStore } from "./daily-limits.counter";
import {
  type DailyLimitsCall,
  getDailyLimits,
  putDailyLimits,
  resetDailyLimit,
} from "./daily-limits.service";

export type DailyLimitsDeps = AuthDeps & {
  hooks?: TestHooks;
  now: () => Date;
  /** Bộ đếm Redis dùng chung với hub-api; vắng ⇒ "đã dùng" = null, đặt lại lượt tải/thao tác ⇒ 503. */
  counter?: DailyCounterStore;
  env?: Record<string, string | undefined>;
};

export function dailyLimitsRoutes(d: DailyLimitsDeps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const guard = [requireAuth(d), requireRole("platform_admin")] as const;
  r.use("/:id/daily-limits", ...guard);
  r.use("/:id/daily-limits/*", ...guard);
  const call = (c: Context<AppVars>): DailyLimitsCall => ({
    ctx: d,
    scope: c.get("scope"),
    actor: c.get("actor"),
    now: d.now,
    env: d.env ?? process.env,
    counter: d.counter ?? null,
  });

  r.get("/:id/daily-limits", async (c) => c.json(await getDailyLimits(call(c), parseIdParam(c))));
  r.put("/:id/daily-limits", async (c) => {
    const id = parseIdParam(c);
    const input = await parseJson(c, DailyLimitsPutSchema);
    return c.json(await putDailyLimits(call(c), id, input));
  });
  r.post("/:id/daily-limits/:kind/reset", async (c) => {
    const id = parseIdParam(c);
    const kind = parseWith(DailyLimitKindSchema, c.req.param("kind"));
    return c.json(await resetDailyLimit(call(c), id, kind));
  });
  return r;
}
