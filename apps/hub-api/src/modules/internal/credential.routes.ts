// WRK-FR-07, HUB-FR-89 · H2a-R17 · Q5 · `POST /internal/jobs/:job_id/dify-credential` (plan H2a §2.4): không JWT/CORS, Bearer
// token job. 200 `DifyCredentialResponse` + `Cache-Control: no-store` · 401 `UNAUTHORIZED` (một body cho mọi sai) · 409
// `NOT_CONFIGURED`. Lỗi bất ngờ (DB) → `onError` 500. Không log header `Authorization` hay thân.
import { HUB_INTERNAL_ERRORS } from "@ai/contracts/hub-internal";
import { Hono } from "hono";
import { toErrorBody } from "../../lib/errors";
import type { DifyCredentialService } from "./credential.service";

/** Câu tĩnh plan-errors H2a §1. */
const UNAUTHORIZED_BODY = toErrorBody("UNAUTHORIZED", "Unauthorized");
const NOT_CONFIGURED_BODY = toErrorBody("NOT_CONFIGURED", "Not configured");
const NO_STORE = { "Cache-Control": "no-store" };

export function credentialRoutes(svc: DifyCredentialService): Hono {
  const r = new Hono();
  r.post("/jobs/:job_id/dify-credential", async (c) => {
    const res = await svc.issue(c.req.header("authorization"), c.req.param("job_id"));
    if (res.kind === "ok") return c.json(res.body, 200, NO_STORE);
    if (res.kind === "not_configured")
      return c.json(NOT_CONFIGURED_BODY, HUB_INTERNAL_ERRORS.NOT_CONFIGURED, NO_STORE);
    return c.json(UNAUTHORIZED_BODY, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
      ...NO_STORE,
      "WWW-Authenticate": "Bearer",
    });
  });
  return r;
}
