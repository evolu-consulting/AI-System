// CR-141 · `GET /contracts/:id/signed-upload` (bước đang chờ + người xem được tải không) · `POST` multipart `file` (PDF/JPG/PNG).
// Guard `write` TRƯỚC khi đọc thân; HĐ không thấy / tenant khác ⇒ 404; không được giao bước ⇒ 403 (Toàn quyền duyệt thay).
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { SignUploadFail, type SignUploadUsecase } from "../application/sign-upload.usecase";
import type { DeleteRole } from "../domain/delete-contract.rules";
import { SIGNED_UPLOAD_LABEL } from "../domain/sign-upload.rules";
import { cleanFileName, fileNameOf } from "./upload.routes";

const SLACK = 64 * 1024;
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof SignUploadFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    if (e.kind === "forbidden") throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    if (e.kind === "file_content")
      throw new AppError("SIGN_UPLOAD_CONTENT", 415, "File content is not a real PDF, JPG or PNG");
    if (e.kind === "not_awaiting")
      throw new AppError(
        "SIGN_UPLOAD_NOT_AWAITING",
        409,
        "Contract is not waiting for a signed copy",
      );
    throw new AppError("FILE_TYPE", 415, `Unsupported file type — only ${SIGNED_UPLOAD_LABEL}`);
  });

export function signUploadRoutes(
  view: PackAccessView,
  uc: SignUploadUsecase,
  roleOf: (w: { tenantId: string; userId: string }) => Promise<DeleteRole>,
  maxBytes: number,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, "contracts", "write");
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
  r.get("/contracts/:id/signed-upload", write, async (c) => {
    const w = who(c);
    c.header("cache-control", "no-store");
    return c.json(await run(uc.state(w, id(c), (await roleOf(w)).admin)));
  });
  r.post(
    "/contracts/:id/signed-upload",
    write,
    bodyLimit({
      maxSize: maxBytes + SLACK,
      onError: () => Promise.reject(new AppError("FILE_TOO_LARGE", 413, "File too large")),
    }),
    async (c) => {
      const cid = id(c);
      const form = await c.req.formData().catch(() => null);
      const file = form?.getAll("file").find((f): f is File => f instanceof Blob);
      if (!file) throw appError("VALIDATION_ERROR");
      if (file.size > maxBytes) throw new AppError("FILE_TOO_LARGE", 413, "File too large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength === 0) throw new AppError("FILE_TYPE", 415, "Empty file");
      const w = who(c);
      const name = cleanFileName(fileNameOf(file));
      return c.json(await run(uc.upload(w, cid, { name, bytes }, (await roleOf(w)).admin)), 201);
    },
  );
  return r;
}
