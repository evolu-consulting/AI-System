// CR-127 · E3 · spec §4.2 · `GET/POST/DELETE /me/delegations` · `GET/POST/DELETE /tenants/:tid/delegations`. Không logic: parse ⇒
// service (quyền ở `delegation.rules` + R#43 trong câu đọc).
import { CreateDelegationRequestSchema } from "@ai/contracts/chat";
import { UuidSchema } from "@ai/contracts/common";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam, parseJson } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { DelegationsService } from "./delegations.service";

export function delegationsRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new DelegationsService(d);
  const r = new Hono<AuthVars>();
  const tid = (c: { req: { param(k: string): string } }) => UuidSchema.parse(c.req.param("tid"));

  r.get("/me/delegations", async (c) => c.json(await svc.list(c.var.user, { mine: true })));
  r.post("/me/delegations", async (c) => {
    const b = await parseJson(c, CreateDelegationRequestSchema);
    return c.json(await svc.create(c.var.user, { ...b, for_user_id: undefined }), 201);
  });
  r.delete("/me/delegations/:id", async (c) =>
    c.json(await svc.revoke(c.var.user, parseIdParam(c))),
  );

  r.get("/tenants/:tid/delegations", async (c) =>
    c.json(await svc.list(c.var.user, { tid: tid(c), mine: false })),
  );
  r.post("/tenants/:tid/delegations", async (c) => {
    const b = await parseJson(c, CreateDelegationRequestSchema);
    return c.json(await svc.create(c.var.user, b, tid(c)), 201);
  });
  r.delete("/tenants/:tid/delegations/:id", async (c) =>
    c.json(await svc.revoke(c.var.user, parseIdParam(c), tid(c))),
  );
  return r;
}
