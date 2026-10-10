// HUB-FR-107 · HUB-FR-109 · PF1 · cổng kiểm (plan §9, plan-contract §3): `POST /review-tasks/:id/decision` (Đạt/Chưa đạt),
// `POST /process-runs/:id/{cancel,decide}`. Mount sẵn ở `processes.mount.ts`. Quyền/khoá/máy trạng thái ở `GateService`.
import {
  CancelProcessRunRequestSchema,
  DecideProcessRunRequestSchema,
  ReviewDecisionRequestSchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { tenantIdQuery } from "../runs/runs.routes";
import { GateService } from "./gates.service";

export function gatesRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new GateService(d);
  const r = new Hono<AuthVars>();

  r.post("/review-tasks/:id/decision", async (c) => {
    const body = await parseJson(c, ReviewDecisionRequestSchema);
    return c.json(await svc.reviewDecision(c.var.user, c.req.param("id"), body, tenantIdQuery(c)));
  });

  r.post("/process-runs/:id/cancel", async (c) => {
    await parseJson(c, CancelProcessRunRequestSchema);
    return c.json(await svc.cancel(c.var.user, c.req.param("id"), tenantIdQuery(c)));
  });

  r.post("/process-runs/:id/decide", async (c) => {
    const body = await parseJson(c, DecideProcessRunRequestSchema);
    return c.json(await svc.decide(c.var.user, c.req.param("id"), body, tenantIdQuery(c)));
  });

  return r;
}
