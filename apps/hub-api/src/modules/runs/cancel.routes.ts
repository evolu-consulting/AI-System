// HUB-FR-43 · E15 `POST /runs/:id/cancel` (C1 plan §2.4), mount ở `/runs`. Body rỗng (không đọc). Thứ tự kiểm:
// auth (401, middleware gốc) → path uuid (404) → sở hữu (404). Trả 200 `Run` — không logic ở đây.
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseIdParam } from "../../lib/http";
import type { CancelService } from "./cancel.service";

export function cancelRoutes(cancel: CancelService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.post("/:id/cancel", async (c) => c.json(await cancel.cancel(c.var.user, parseIdParam(c))));
  return r;
}
