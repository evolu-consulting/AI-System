// ADM-FR-01, ADM-FR-06 · GET/PATCH /auth/me và đổi mật khẩu tự đổi (Bearer, mọi role) — spec M1 §3.
import { MeUpdateRequestSchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, authenticate, requireAuth } from "../../lib/auth-middleware";
import { parseJson } from "../../lib/http";
import type { SelfChangeInput } from "./auth.routes";
import { type AuthCtx, changePasswordSelf, getMe, updateMyLocale } from "./auth.service";

export function meRoutes(d: AuthCtx & AuthDeps): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("/me", requireAuth(d));
  r.get("/me", async (c) => c.json(await getMe(d, c.get("actor"))));
  r.patch("/me", async (c) => {
    const { locale } = await parseJson(c, MeUpdateRequestSchema);
    return c.json(await updateMyLocale(d, c.get("actor"), locale));
  });
  return r;
}

/** Gắn vào `authRoutes({ selfChange })`: body đã parse; xác thực Bearer ở đây (chế độ bắt buộc không cần). */
export function selfChangeHandler(d: AuthCtx & AuthDeps) {
  return async (c: Context, input: SelfChangeInput): Promise<Response> => {
    const actor = await authenticate(c, d);
    await changePasswordSelf(d, actor, input);
    return c.body(null, 204);
  };
}
