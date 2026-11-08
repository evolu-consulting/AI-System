// CR-125 · cr125-manual-start-engine · `GET /processes/startable` + `POST /processes/start` (JWT: tiền tố `/processes`). Không logic:
// parse (400) → service (tenant = JWT). Bắt đầu mới ⇒ 201; gửi lại cùng `request_id` ⇒ 200 + `created: false`.
import { StartProcessRequestSchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { ManualStartService } from "./manual-start.service";

export function manualStartRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new ManualStartService(d);
  const r = new Hono<AuthVars>();
  r.get("/processes/startable", async (c) => c.json({ items: await svc.startable(c.var.user) }));
  r.post("/processes/start", async (c) => {
    const b = await parseJson(c, StartProcessRequestSchema);
    const out = await svc.start(c.var.user, b);
    return c.json(out, out.created ? 201 : 200);
  });
  return r;
}
