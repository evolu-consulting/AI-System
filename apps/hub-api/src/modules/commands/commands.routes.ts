// HUB-FR-10 · GET `/commands` (plan §2.4): JWT mọi role (401 ở middleware gốc) → menu `/`. Không logic.
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import type { CommandService } from "./commands.service";

export function commandRoutes(svc: CommandService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/", async (c) => c.json(await svc.menu(c.var.user)));
  return r;
}
