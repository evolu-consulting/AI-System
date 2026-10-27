// trello-config-ui · `/admin/integrations/trello*` — chỉ platform_admin (kiểm role trước khi đọc body).
// Lỗi VALIDATION_ERROR dùng message tĩnh theo `code` (như /admin/secrets): không bao giờ echo input (có thể là key/token).
import { TrelloConfigSaveRequestSchema } from "@ai/contracts";
import { Hono } from "hono";
import { type AppVars, type AuthDeps, requireAuth, requireRole } from "../../lib/auth-middleware";
import { readJson, validationError } from "../../lib/http";
import {
  checkTrello,
  clearTrello,
  getTrelloView,
  saveTrello,
  type TrelloCtx,
} from "./trello-config.service";

export function trelloConfigRoutes(d: AuthDeps & TrelloCtx): Hono<AppVars> {
  const r = new Hono<AppVars>();
  r.use("*", requireAuth(d), requireRole("platform_admin"));
  r.get("/", async (c) => c.json(await getTrelloView(d)));
  r.put("/", async (c) => {
    const p = TrelloConfigSaveRequestSchema.safeParse(await readJson(c));
    if (!p.success)
      throw validationError(
        p.error.issues.map((i) => ({
          path: i.path.map((x) => (typeof x === "number" ? x : String(x))),
          code: i.code,
          message: i.code.replace(/_/g, " "),
        })),
      );
    return c.json(await saveTrello(d, c.get("actor"), p.data));
  });
  r.delete("/", async (c) => {
    await clearTrello(d, c.get("actor"));
    return c.body(null, 204);
  });
  r.post("/check", async (c) => c.json(await checkTrello(d)));
  return r;
}
