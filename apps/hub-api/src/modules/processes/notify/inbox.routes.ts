// HUB-FR-112 · PF3 · `GET /me/review-tasks`, `GET /me/process-inbox`, `POST /me/process-inbox/read` (plan §9,
// plan-contract §3). `/me/*` đã được `requireAuth` ở app.ts (X2a). Route chỉ parse contract → service → JSON, không logic.
import {
  MarkProcessInboxReadRequestSchema,
  ProcessInboxQuerySchema,
  ReviewTaskListQuerySchema,
} from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson, parseQuery } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { listInbox, listReviewTasks, markInboxRead } from "./inbox.service";

export function inboxRoutes(d: ProcessDeps): Hono<AuthVars> {
  const r = new Hono<AuthVars>();

  r.get("/me/review-tasks", async (c) =>
    c.json(await listReviewTasks(d, c.var.user, parseQuery(c, ReviewTaskListQuerySchema))),
  );

  r.get("/me/process-inbox", async (c) =>
    c.json(await listInbox(d, c.var.user, parseQuery(c, ProcessInboxQuerySchema))),
  );

  r.post("/me/process-inbox/read", async (c) => {
    const body = await parseJson(c, MarkProcessInboxReadRequestSchema);
    return c.json(await markInboxRead(d, c.var.user, body.up_to_id));
  });

  return r;
}
