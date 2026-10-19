// HD-FR-95 · BR-9 · D9-16: `POST /pack/contracts/cks/signed-docs/upload` (multipart `files`). Guard `write` TRƯỚC đọc thân; thân
// > 64 MB ⇒ 413 sớm theo `Content-Length` (chunked ⇒ `bodyLimit` đếm); > 50 tệp ⇒ 413; tệp > 20 MB / sai đuôi ⇒ `unreadable`.
import { CKS_UPLOAD_BODY_MAX_BYTES, CKS_UPLOAD_MAX_FILES } from "@ai/contracts";
import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError, appError } from "../../../../../lib/errors";
import type { PackGuardVars } from "../../../kit/adapters/pack-guard.middleware";
import type { CksUpload } from "../application/signed.usecase";

const tooLarge = (m = "Payload too large") => new AppError("PAYLOAD_TOO_LARGE", 413, m);

function limitBody(max: number): MiddlewareHandler {
  const limit = bodyLimit({ maxSize: max, onError: () => Promise.reject(tooLarge()) });
  return async (c, next) => {
    const len = Number(c.req.header("content-length"));
    if (Number.isFinite(len) && len > max) throw tooLarge();
    return limit(c, next);
  };
}

export function signedUploadRoute(
  r: Hono<PackGuardVars>,
  write: MiddlewareHandler<PackGuardVars>,
  upload: CksUpload,
) {
  r.post("/cks/signed-docs/upload", write, limitBody(CKS_UPLOAD_BODY_MAX_BYTES), async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) throw appError("VALIDATION_ERROR");
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (files.length > CKS_UPLOAD_MAX_FILES)
      throw tooLarge(`Tối đa ${CKS_UPLOAD_MAX_FILES} file mỗi lần`);
    const u = c.get("user");
    const out = await upload(
      { tenantId: u.tenantId, userId: u.userId },
      files.map((f) => ({
        name: f.name,
        size: f.size,
        bytes: async () => new Uint8Array(await f.arrayBuffer()),
      })),
    );
    return c.json(out);
  });
}
