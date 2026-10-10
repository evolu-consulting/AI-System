// HUB-FR-110 · HUB-FR-111 · PF2 · `POST /review-tasks/:id/{answer,forward}` (plan §9, plan-contract §3). Không logic:
// id (404 nếu không uuid) → service (quyền xem 404 → zod 400 → 409 bên trong tx) → phát sự kiện + `kick` SAU COMMIT.
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam, readJson } from "../../../lib/http";
import { publishUserEvents } from "../../../lib/user-stream";
import type { ProcessDeps } from "../core/ports";
import { type AskResult, AsksService } from "./asks.service";

export function asksRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new AsksService(d);
  const r = new Hono<AuthVars>();

  /** Phát sự kiện rồi `kick` (PF1 chạy tiếp stage) — cả hai SAU COMMIT. */
  async function after(res: AskResult): Promise<AskResult> {
    await publishUserEvents(d.redis, res.events, d.log);
    if (res.kick) await d.launcher.kick(res.kick);
    return res;
  }

  r.post("/review-tasks/:id/answer", async (c) => {
    const id = parseIdParam(c);
    const res = await after(await svc.answer(c.var.user, id, await readJson(c)));
    return c.json(res.detail);
  });

  r.post("/review-tasks/:id/forward", async (c) => {
    const id = parseIdParam(c);
    const res = await after(await svc.forward(c.var.user, id, await readJson(c)));
    return c.json(res.detail);
  });

  return r;
}
