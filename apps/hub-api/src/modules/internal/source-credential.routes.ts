// HUB-FR-129 · HUB-BR-30 · PC2-R11 · P-c2 · `POST /internal/jobs/:job_id/source-credential` (plan §3.4, §6.3): không JWT/CORS,
// Bearer token job. 200 `{username, token}` + `Cache-Control: no-store` · 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` MỘT thân
// + `WWW-Authenticate: Bearer` · 404 `NOT_FOUND` MỘT thân (sai điều kiện / nguồn ngoài job / không khoá / tenant khác — tránh
// dò) · 409 `NOT_CONFIGURED` (khoá mất/giải mã hỏng) · 500 `INTERNAL_ERROR`. Không log token/giá trị.
import { HUB_INTERNAL_ERRORS, SourceCredentialRequestSchema } from "@ai/contracts/hub-internal";
import { type Context, type Env, Hono } from "hono";
import type { Db } from "../../lib/db";
import { safeErrorFields, toErrorBody } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { SecretKey } from "../secrets/secrets.crypto";
import { HubSecretReader } from "../secrets/secrets.use";
import { type SourceCredentialResult, SourceCredentialService } from "./source-credential.service";

const NO_STORE = { "Cache-Control": "no-store" };
const BODIES = {
  unauthorized: toErrorBody("UNAUTHORIZED", "Unauthorized"),
  invalid: toErrorBody("VALIDATION_ERROR", "Invalid request"),
  not_found: toErrorBody("NOT_FOUND", "Not found"),
  not_configured: toErrorBody("NOT_CONFIGURED", "Not configured"),
  internal: toErrorBody("INTERNAL_ERROR", "Internal server error"),
};

function toResponse(c: Context, res: SourceCredentialResult): Response {
  switch (res.kind) {
    case "ok":
      return c.json(res.body, 200, NO_STORE);
    case "unauthorized":
      return c.json(BODIES.unauthorized, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
        ...NO_STORE,
        "WWW-Authenticate": "Bearer",
      });
    case "not_found":
      return c.json(BODIES.not_found, HUB_INTERNAL_ERRORS.NOT_FOUND, NO_STORE);
    case "not_configured":
      return c.json(BODIES.not_configured, HUB_INTERNAL_ERRORS.NOT_CONFIGURED, NO_STORE);
  }
}

export function sourceCredentialRoutes(svc: SourceCredentialService, log: Logger): Hono {
  const r = new Hono();
  r.post(
    "/jobs/:job_id/source-credential",
    // 401 đồng nhất trước 400: thiếu/sai dạng Bearer ⇒ 401 ngay (token hợp lệ do service kiểm sau).
    async (c, next) =>
      /^Bearer \S+$/.test(c.req.header("authorization") ?? "")
        ? next()
        : c.json(BODIES.unauthorized, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
            ...NO_STORE,
            "WWW-Authenticate": "Bearer",
          }),
    async (c) => {
      try {
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json(BODIES.invalid, HUB_INTERNAL_ERRORS.VALIDATION_ERROR, NO_STORE);
        }
        const parsed = SourceCredentialRequestSchema.safeParse(body);
        if (!parsed.success)
          return c.json(BODIES.invalid, HUB_INTERNAL_ERRORS.VALIDATION_ERROR, NO_STORE);
        const res = await svc.issue(
          c.req.header("authorization"),
          c.req.param("job_id"),
          parsed.data.source_id,
        );
        return toResponse(c, res);
      } catch (err) {
        log.error("source-credential-failed", safeErrorFields(err));
        return c.json(BODIES.internal, HUB_INTERNAL_ERRORS.INTERNAL_ERROR, NO_STORE);
      }
    },
  );
  return r;
}

export type SourceCredentialMountDeps = { db: Db; key: SecretKey | null; log: Logger };

/** Mount `/internal` (gọi trước `notFound`). Khoá vắng ⇒ `useSecret` ném `key_missing` ⇒ 409 (fail-closed). */
export function mountSourceCredential<E extends Env>(
  app: Hono<E>,
  d: SourceCredentialMountDeps,
): void {
  const svc = new SourceCredentialService({
    db: d.db,
    reader: new HubSecretReader({ db: d.db, key: d.key, log: d.log }),
    log: d.log,
  });
  app.route("/internal", sourceCredentialRoutes(svc, d.log));
}
