// HUB-FR-122 · PB-R05/R18 · `POST /internal/jobs/:job_id/sources-resolved` (không JWT — Bearer job-token). 200 ack ·
// 401 cùng thân (sai token/job) · 422 VALIDATION_ERROR (source_id ∉ job.items). `Cache-Control: no-store`.
import { SourcesResolvedRequestSchema } from "@ai/contracts/hub-internal";
import { type Context, Hono } from "hono";
import { mapError, toErrorBody } from "../../lib/errors";
import { parseJson, validationError } from "../../lib/http";
import type { SourcesResolvedService } from "./resolved.service";

const UNAUTHORIZED_BODY = toErrorBody("UNAUTHORIZED", "Unauthorized");
const NO_STORE = { "Cache-Control": "no-store" };

const unauthorized = (c: Context) =>
  c.json(UNAUTHORIZED_BODY, 401, { ...NO_STORE, "WWW-Authenticate": "Bearer" });

export function sourcesResolvedRoutes(svc: SourcesResolvedService): Hono {
  const r = new Hono();
  // C15/PB-R18: job-token `source.resolve` KHÔNG được tải attachment qua H2c ⇒ 401 (cross-tenant/chưa phục vụ byte S1).
  // Token khác (agent.cli) ⇒ nhường handler H2c. Đăng ký trước mount H2c ⇒ chạy trước, `next()` để fall-through.
  r.get("/jobs/:job_id/attachments/:attachment_id", async (c, next) => {
    const ok = await svc.delegateToH2c(
      c.req.header("authorization"),
      c.req.param("job_id"),
      c.req.param("attachment_id"),
    );
    if (ok) return next();
    return unauthorized(c);
  });
  r.post("/jobs/:job_id/sources-resolved", async (c) => {
    // Token kiểm trước; body parse sau (malformed ⇒ 400 VALIDATION_ERROR).
    const body = await parseJson(c, SourcesResolvedRequestSchema);
    try {
      const res = await svc.resolved(c.req.header("authorization"), c.req.param("job_id"), body);
      if (res.kind === "unauthorized") return unauthorized(c);
      if (res.kind === "invalid")
        throw validationError([
          { path: ["results"], code: "custom", message: "source_id not in job" },
        ]);
      return c.json({ ok: true }, 200, NO_STORE);
    } catch (err) {
      const { status, body: eb } = mapError(err);
      return c.json(eb, status, NO_STORE);
    }
  });
  return r;
}
