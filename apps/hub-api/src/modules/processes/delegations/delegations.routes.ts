// CR-127 · E3 · spec §4.2 · `GET/POST/DELETE /me/delegations` · `GET/POST/DELETE /tenants/:tid/delegations`. Không logic: parse ⇒
// service (quyền ở `delegation.rules` + R#43 trong câu đọc).
import { CreateDelegationRequestSchema, DelegationPageQuerySchema } from "@ai/contracts/chat";
import { UuidSchema } from "@ai/contracts/common";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { parseIdParam, parseJson, parseQuery } from "../../../lib/http";
import type { ProcessDeps } from "../core/ports";
import { DelegationsService } from "./delegations.service";

export function delegationsRoutes(d: ProcessDeps): Hono<AuthVars> {
  const svc = new DelegationsService(d);
  const r = new Hono<AuthVars>();
  const tid = (c: { req: { param(k: string): string } }) => UuidSchema.parse(c.req.param("tid"));

  r.get("/me/delegations", async (c) => c.json(await svc.list(c.var.user, { mine: true })));
  // CR-184 · đặt TRƯỚC `/me/delegations/:id` (cùng tiền tố) để «history» không bị đọc thành id.
  r.get("/me/delegations/history", async (c) =>
    c.json(
      await svc.history(c.var.user, { mine: true, ...parseQuery(c, DelegationPageQuerySchema) }),
    ),
  );
  r.get("/me/delegations/esign-eligible", async (c) =>
    c.json({
      eligible: await svc.esignEligible(c.var.user, UuidSchema.parse(c.req.query("user_id"))),
    }),
  );
  r.get("/me/delegations/:id/work", async (c) =>
    c.json(await svc.work(c.var.user, parseIdParam(c), parseQuery(c, DelegationPageQuerySchema))),
  );
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
  r.get("/tenants/:tid/delegations/history", async (c) =>
    c.json(
      await svc.history(c.var.user, {
        tid: tid(c),
        mine: false,
        ...parseQuery(c, DelegationPageQuerySchema),
      }),
    ),
  );
  r.get("/tenants/:tid/delegations/:id/work", async (c) =>
    c.json(
      await svc.work(c.var.user, parseIdParam(c), {
        tid: tid(c),
        ...parseQuery(c, DelegationPageQuerySchema),
      }),
    ),
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
