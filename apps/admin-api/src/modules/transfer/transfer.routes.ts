// ADM-FR-54 · M4-AC12 · /admin/export* (plan-cd §3.1). Chỉ platform_admin (tenant_admin/member → 403 FORBIDDEN).
// `importRoutes` gắn ở `/admin/import` (plan-cd §3.3). Gắn ở `/admin/export` (không gắn `/admin` với `use("*")`: middleware sẽ chạy cho mọi route /admin khác).
import {
  ExportQuerySchema,
  IMPORT_MAX_BYTES,
  ImportQuerySchema,
  ImportRequestSchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { appError } from "../../lib/errors";
import { parseJson, parseQuery } from "../../lib/http";
import { applyImport, type ImportCtx } from "./transfer.apply";
import { previewImport } from "./transfer.import";
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

/** Body thô > 2 MiB (nội dung 1 MiB sau JSON escape) → 413 trước khi đọc JSON. */
export const IMPORT_BODY_LIMIT = 2 * IMPORT_MAX_BYTES;

export function importRoutes(d: AuthDeps & ImportCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("platform_admin"));
  r.post(
    "/",
    bodyLimit({
      maxSize: IMPORT_BODY_LIMIT,
      onError: () => {
        throw appError("PAYLOAD_TOO_LARGE", { max_bytes: IMPORT_MAX_BYTES });
      },
    }),
    async (c) => {
      const { dry_run } = parseQuery(c, ImportQuerySchema);
      const req = await parseJson(c, ImportRequestSchema);
      const call = { ctx: d, actor: c.get("actor"), scope: c.get("scope") };
      if (dry_run === "1") return c.json(await previewImport(call, req));
      return c.json(await applyImport(call, req));
    },
  );
  return r;
}
