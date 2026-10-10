// HUB-FR-105 · HUB-FR-113 · ADM-FR-67 · PF1 · `GET /processes`, `POST /process-runs`, `GET /process-runs` (plan §9,
// plan-contract §3). Mount sẵn ở `processes.mount.ts`. GET run/:id, outputs, cancel, decide ⇒ B5/B6a (thêm sau).
import {
  CreateProcessRunRequestSchema,
  PROCESS_RUN_ID_HEADER,
  ProcessRunListQuerySchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson, parseQuery } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { StartService } from "./start.service";

export function processRunsRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new StartService(d);
  const r = new Hono<AuthVars>();

  r.get("/processes", async (c) => c.json({ items: await svc.catalog(c.var.user) }));

  r.post("/process-runs", async (c) => {
    const body = await parseJson(c, CreateProcessRunRequestSchema);
    const run = await svc.createFromApi(c.var.user, body);
    c.header(PROCESS_RUN_ID_HEADER, run.id);
    return c.json(run, 201);
  });

  r.get("/process-runs", async (c) => {
    const q = parseQuery(c, ProcessRunListQuerySchema);
    return c.json(await svc.list(c.var.user, q));
  });

  return r;
}
