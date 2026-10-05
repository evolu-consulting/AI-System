// HUB-FR-75 · WRK-BR-06 · H2c-R17 · P16 · `GET /internal/jobs/:job_id/attachments/:attachment_id` (plan H2c §2.4, plan-errors
// §1 nội bộ): không JWT, Bearer token job. 200 byte `application/octet-stream` + `Content-Length` + `X-Content-SHA256` +
// `Cache-Control: no-store` · 401 `UNAUTHORIZED` một thân + `WWW-Authenticate: Bearer` · 404 `NOT_FOUND` (nội dung đã xoá/mất).
// WRK-FR-18 · H2c-R25 · P21 · `POST /internal/jobs/:job_id/outputs` (byte + `X-Filename`): 201 `JobOutputResponse` · 401 như
// trên · 400/409/413/415 thân `toErrorBody` như `POST /attachments` — mọi phản hồi `Cache-Control: no-store`.
import { FILENAME_HEADER } from "@ai/contracts/chat";
import {
  CONTENT_SHA256_HEADER,
  HUB_INTERNAL_ERRORS,
  type JobOutputResponse,
} from "@ai/contracts/hub-internal";
import { type Context, Hono } from "hono";
import { blobResponse } from "../../lib/blob-body";
import { mapError, safeErrorFields, toErrorBody } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { contentLengthOf } from "../attachments/attachments.routes";
import { type InternalAttachmentService, OCTET } from "./attachments.service";

/** Câu tĩnh plan-errors §1 (cùng thân H2a `credential.routes`). */
const UNAUTHORIZED_BODY = toErrorBody("UNAUTHORIZED", "Unauthorized");
const NOT_FOUND_BODY = toErrorBody("NOT_FOUND", "Not found");
const NO_STORE = { "Cache-Control": "no-store" };

const unauthorized = (c: Context) =>
  c.json(UNAUTHORIZED_BODY, HUB_INTERNAL_ERRORS.UNAUTHORIZED, {
    ...NO_STORE,
    "WWW-Authenticate": "Bearer",
  });

/** Lỗi tải lên (`AppError` 4xx, lỗi lạ 500) → thân `toErrorBody` + `no-store` (plan-errors §1 nội bộ). */
function outputError(c: Context, err: unknown, log: Logger): Response {
  const { status, body } = mapError(err);
  if (status >= 500) log.error("attachment-output-failed", safeErrorFields(err));
  return c.json(body, status, NO_STORE);
}

export function internalAttachmentRoutes(svc: InternalAttachmentService, log: Logger): Hono {
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
    return unauthorized(c);
  });
  r.post("/jobs/:job_id/outputs", async (c) => {
    try {
      const res = await svc.output(c.req.header("authorization"), c.req.param("job_id"), {
        filenameRaw: c.req.header(FILENAME_HEADER),
        contentLength: contentLengthOf(c.req.header("content-length")),
        body: c.req.raw.body,
      });
      if (res.kind !== "ok") return unauthorized(c);
      const out: JobOutputResponse = { id: res.id };
      return c.json(out, 201, NO_STORE);
    } catch (err) {
      return outputError(c, err, log);
    }
  });
  return r;
}
