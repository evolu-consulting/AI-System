// HUB-FR-102 · `GET /directory` (X2a plan §3). Auth ở gốc (`PROTECTED_PREFIXES`) → query 400 → service. Không logic.
import { DirectoryQuerySchema } from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseQuery } from "../../lib/http";
import type { DirectoryService } from "./directory.service";

export function directoryRoutes(svc: DirectoryService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/", async (c) =>
    c.json(await svc.search(c.var.user, parseQuery(c, DirectoryQuerySchema))),
  );
  return r;
}
