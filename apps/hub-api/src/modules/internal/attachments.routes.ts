// HUB-FR-75 · WRK-BR-06 · H2c-R17 · P16 · `GET /internal/jobs/:job_id/attachments/:attachment_id` (plan H2c §2.4, plan-errors
// §1 nội bộ): không JWT, Bearer token job. 200 byte `application/octet-stream` + `Content-Length` + `X-Content-SHA256` +
// `Cache-Control: no-store` · 401 `UNAUTHORIZED` một thân + `WWW-Authenticate: Bearer` · 404 `NOT_FOUND` (nội dung đã xoá/mất).
import { CONTENT_SHA256_HEADER, HUB_INTERNAL_ERRORS } from "@ai/contracts/hub-internal";
import { Hono } from "hono";
import { blobResponse } from "../../lib/blob-body";
import { toErrorBody } from "../../lib/errors";
import { type InternalAttachmentService, OCTET } from "./attachments.service";

/** Câu tĩnh plan-errors §1 (cùng thân H2a `credential.routes`). */
const UNAUTHORIZED_BODY = toErrorBody("UNAUTHORIZED", "Unauthorized");
const NOT_FOUND_BODY = toErrorBody("NOT_FOUND", "Not found");
const NO_STORE = { "Cache-Control": "no-store" };

export function internalAttachmentRoutes(svc: InternalAttachmentService): Hono {
  const r = new Hono();
  r.get("/jobs/:job_id/attachments/:attachment_id", async (c) => {
    const res = await svc.download(
      c.req.header("authorization"),
      c.req.param("job_id"),
      c.req.param("attachment_id"),
    );
    if (res.kind === "ok")
      return blobResponse(c, res.blob, 200, {
        ...NO_STORE,
        "Content-Type": OCTET,
        "Content-Length": String(res.blob.size),
        [CONTENT_SHA256_HEADER]: res.sha256,
      });
    if (res.kind === "not_found")
      return c.json(NOT_FOUND_BODY, HUB_INTERNAL_ERRORS.NOT_FOUND, NO_STORE);
    return c.json(UNAUTHORIZED_BODY, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
      ...NO_STORE,
      "WWW-Authenticate": "Bearer",
    });
  });
  return r;
}
