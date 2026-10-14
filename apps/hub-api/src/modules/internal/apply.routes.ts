// HUB-FR-129 · HUB-FR-130 · WRK-FR-29 · P-c2 · `POST /internal/jobs/:job_id/apply-result` (plan §3.5, §6.3): không JWT/CORS,
// Bearer token job. 201 `{id}` · 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` MỘT thân + `WWW-Authenticate: Bearer` · 409
// `APPLY_NOT_EXPECTED` (job không `source.apply`/không `running`) / `APPLY_RESULT_EXISTS` · 413 `PAYLOAD_TOO_LARGE` (thân >
// 256 KiB; 401 xét trước 413 — mẫu `autofix.routes.ts`, C30; mã chỉ ở `error.code`, G10) · 500 `INTERNAL_ERROR`. Mọi phản hồi
// `Cache-Control: no-store`.
import {
  APPLY_BODY_MAX_BYTES,
  HUB_INTERNAL_ERRORS,
  type JobOutputResponse,
} from "@ai/contracts/hub-internal";
import { type Context, type Env, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Db } from "../../lib/db";
import { safeErrorFields, toErrorBody } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { AttachmentStorage } from "../attachments/storage";
import { type ApplyReportResult, InternalApplyService } from "./apply.service";

const NO_STORE = { "Cache-Control": "no-store" };
const BODIES = {
  unauthorized: toErrorBody("UNAUTHORIZED", "Unauthorized"),
  invalid: toErrorBody("VALIDATION_ERROR", "Invalid request"),
  not_expected: toErrorBody("APPLY_NOT_EXPECTED", "Job does not expect an apply result"),
  exists: toErrorBody("APPLY_RESULT_EXISTS", "Apply result already recorded"),
  too_large: toErrorBody("PAYLOAD_TOO_LARGE", "Payload too large"),
  internal: toErrorBody("INTERNAL_ERROR", "Internal server error"),
};

const tooLarge = (c: Context) => c.json(BODIES.too_large, 413, NO_STORE);

function toResponse(c: Context, res: ApplyReportResult): Response {
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
      return c.json(BODIES.not_expected, HUB_INTERNAL_ERRORS.APPLY_NOT_EXPECTED, NO_STORE);
    case "exists":
      return c.json(BODIES.exists, HUB_INTERNAL_ERRORS.APPLY_RESULT_EXISTS, NO_STORE);
  }
}

export function internalApplyRoutes(svc: InternalApplyService, log: Logger): Hono {
  const r = new Hono();
  r.post(
    "/jobs/:job_id/apply-result",
    // 401 đồng nhất trước 413: thiếu/sai dạng Bearer ⇒ 401 ngay, không đọc body (token hợp lệ do service kiểm sau).
    async (c, next) =>
      /^Bearer \S+$/.test(c.req.header("authorization") ?? "")
        ? next()
        : c.json(BODIES.unauthorized, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
            ...NO_STORE,
            "WWW-Authenticate": "Bearer",
          }),
    bodyLimit({ maxSize: APPLY_BODY_MAX_BYTES, onError: tooLarge }),
    async (c) => {
      try {
        const raw = await c.req.text();
        const res = await svc.report(c.req.header("authorization"), c.req.param("job_id"), raw);
        return toResponse(c, res);
      } catch (err) {
        log.error("apply-result-failed", safeErrorFields(err));
        return c.json(BODIES.internal, HUB_INTERNAL_ERRORS.INTERNAL_ERROR, NO_STORE);
      }
    },
  );
  return r;
}

export type ApplyResultMountDeps = { db: Db; storage: AttachmentStorage; log: Logger };

/** Mount `/internal` (gọi trước `notFound`); chỉ khi có kho file (blob log test). */
export function mountApplyResult<E extends Env>(app: Hono<E>, d: ApplyResultMountDeps): void {
  const svc = new InternalApplyService({ db: d.db, storage: d.storage, log: d.log });
  app.route("/internal", internalApplyRoutes(svc, d.log));
}
