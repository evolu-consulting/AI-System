// HUB-FR-130 · WRK-FR-29 · P-c1 · `POST /internal/jobs/:job_id/autofix-result` (plan §3.3): không JWT, Bearer token job.
// 201 `{id}` · 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` một thân + `WWW-Authenticate: Bearer` · 409 `AUTOFIX_NOT_EXPECTED`
// / `AUTOFIX_RESULT_EXISTS` · 413 `PAYLOAD_TOO_LARGE` (diff > 2 MiB hoặc thân > 3 MiB; mã chỉ ở `error.code`, không thuộc
// `HUB_INTERNAL_ERRORS` — G10) · 500 `INTERNAL_ERROR`. Mọi phản hồi `Cache-Control: no-store`.
import {
  AUTOFIX_BODY_MAX_BYTES,
  HUB_INTERNAL_ERRORS,
  type JobOutputResponse,
} from "@ai/contracts/hub-internal";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { safeErrorFields, toErrorBody } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { AutofixReportResult, InternalAutofixService } from "./autofix.service";

const NO_STORE = { "Cache-Control": "no-store" };
const BODIES = {
  unauthorized: toErrorBody("UNAUTHORIZED", "Unauthorized"),
  invalid: toErrorBody("VALIDATION_ERROR", "Invalid request"),
  not_expected: toErrorBody("AUTOFIX_NOT_EXPECTED", "Job does not expect an autofix result"),
  exists: toErrorBody("AUTOFIX_RESULT_EXISTS", "Autofix result already recorded"),
  too_large: toErrorBody("PAYLOAD_TOO_LARGE", "Payload too large"),
  internal: toErrorBody("INTERNAL_ERROR", "Internal server error"),
};

const tooLarge = (c: Context) => c.json(BODIES.too_large, 413, NO_STORE);

function toResponse(c: Context, res: AutofixReportResult): Response {
  switch (res.kind) {
    case "ok": {
      const out: JobOutputResponse = { id: res.id };
      return c.json(out, 201, NO_STORE);
    }
    case "unauthorized":
      return c.json(BODIES.unauthorized, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
        ...NO_STORE,
        "WWW-Authenticate": "Bearer",
      });
    case "invalid":
      return c.json(BODIES.invalid, HUB_INTERNAL_ERRORS.VALIDATION_ERROR, NO_STORE);
    case "not_expected":
      return c.json(BODIES.not_expected, HUB_INTERNAL_ERRORS.AUTOFIX_NOT_EXPECTED, NO_STORE);
    case "exists":
      return c.json(BODIES.exists, HUB_INTERNAL_ERRORS.AUTOFIX_RESULT_EXISTS, NO_STORE);
    case "too_large":
      return tooLarge(c);
  }
}

export function internalAutofixRoutes(svc: InternalAutofixService, log: Logger): Hono {
  const r = new Hono();
  r.post(
    "/jobs/:job_id/autofix-result",
    bodyLimit({ maxSize: AUTOFIX_BODY_MAX_BYTES, onError: tooLarge }),
    async (c) => {
      try {
        const raw = await c.req.text();
        const res = await svc.report(c.req.header("authorization"), c.req.param("job_id"), raw);
        return toResponse(c, res);
      } catch (err) {
        log.error("autofix-result-failed", safeErrorFields(err));
        return c.json(BODIES.internal, HUB_INTERNAL_ERRORS.INTERNAL_ERROR, NO_STORE);
      }
    },
  );
  return r;
}
