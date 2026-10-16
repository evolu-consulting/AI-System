// DLC-R11 · DLC-R12 · `GET /dlc/workspaces` · `GET /dlc/conversations/:id/process`. Thứ tự kiểm như E5–E11: auth (401,
// middleware gốc) → path uuid (404) → sở hữu + phiên DLC (404). Không logic.
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { parseIdParam } from "../../lib/http";
import type { DlcEngine } from "./dlc.engine";
import { dlcService } from "./dlc.service";

export function dlcRoutes(db: Db, engine?: DlcEngine): Hono<AuthVars> {
  const svc = dlcService(db, engine);
  const r = new Hono<AuthVars>();
  r.get("/workspaces", async (c) => c.json(await svc.workspaces(c.var.user)));
  r.get("/conversations/:id/process", async (c) =>
    c.json(await svc.process(c.var.user, parseIdParam(c))),
  );
  return r;
}
