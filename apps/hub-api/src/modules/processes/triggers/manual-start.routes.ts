// CR-125 · cr125-manual-start-engine · `GET /processes/startable` + `POST /processes/start` (JWT: tiền tố `/processes`). Không logic:
// parse (400) → service (tenant = JWT). Bắt đầu mới ⇒ 201; gửi lại cùng `request_id` ⇒ 200 + `created: false`.

import { UuidSchema } from "@ai/contracts/common";
import { StartProcessRequestSchema } from "@ai/contracts/hub-admin";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseJson } from "../../../lib/http";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import { ManualRequestService } from "./manual-request.service";
import { ManualStartService } from "./manual-start.service";
import { MyRequestsService } from "./my-requests.service";

export function manualStartRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new ManualStartService(d);
  const req = new ManualRequestService(d);
  const mine = new MyRequestsService(d);
  const r = new Hono<AuthVars>();
  r.get("/processes/startable", async (c) => c.json({ items: await svc.startable(c.var.user) }));
  r.get("/processes/requests/mine", async (c) => c.json(await mine.list(c.var.user))); // trước `:run_id`
  r.get("/processes/requests/:run_id", async (c) => {
    const id = c.req.param("run_id");
    if (!UuidSchema.safeParse(id).success)
      throw processError("PROCESS_NOT_FOUND", { suggestions: [] });
    return c.json(await req.get(c.var.user, id));
  });
  r.post("/processes/start", async (c) => {
    const b = await parseJson(c, StartProcessRequestSchema);
    const out = await svc.start(c.var.user, b);
    return c.json(out, out.created ? 201 : 200);
  });
  return r;
}
