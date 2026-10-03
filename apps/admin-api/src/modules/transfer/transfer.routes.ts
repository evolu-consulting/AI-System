// ADM-FR-54 · M4-AC12 · /admin/export* (plan-cd §3.1). Chỉ platform_admin (tenant_admin/member → 403 FORBIDDEN).
// Gắn ở `/admin/export` (không gắn `/admin` với `use("*")`: middleware sẽ chạy cho mọi route /admin khác).
import { ExportQuerySchema } from "@ai/contracts";
import { type Context, Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { parseQuery } from "../../lib/http";
import { type Call, exportConfig, exportMeta, type TransferCtx } from "./transfer.service";

export function exportRoutes(d: AuthDeps & TransferCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  const call = (c: Context<AppVars>): Call => ({
    ctx: d,
    actor: c.get("actor"),
    scope: c.get("scope"),
  });
  r.use("*", requireAuth(d), requireRole("platform_admin"));

  r.get("/", async (c) => {
    const { types } = parseQuery(c, ExportQuerySchema);
    const out = await exportConfig(call(c), types);
    return c.body(out.text, 200, {
      "Content-Type": "application/yaml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.fileName}"`,
      "X-Config-Version": String(out.configVersion),
    });
  });
  r.get("/meta", async (c) => c.json(await exportMeta(call(c))));
  return r;
}
