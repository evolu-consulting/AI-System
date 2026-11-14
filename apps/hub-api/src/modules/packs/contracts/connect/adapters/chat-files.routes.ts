// CR-161 · lát 6 · tệp trò chuyện (R11): `POST /connect/threads/:tenant_id/files` (multipart `file`; đuôi theo danh sách chung của tin nhắn SHT ⇒ 415,
// > 20 MB ⇒ 413, chưa kết nối ⇒ 409) và `GET /connect/files/:file_id` (302 tới link FileBox hạn ngắn; không thấy ⇒ 404 không lộ có/không).
// `packGuard` Toàn quyền TRƯỚC mọi việc (nhân viên ⇒ 403, 0 SQL, 0 byte). Kho vắng ⇒ 503 `FILE_STORAGE_UNAVAILABLE`.
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import { MSG_ERRORS } from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../../lib/errors";
import { parseWith } from "../../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import { cleanFileName, fileNameOf } from "../../adapters/upload.routes";
import { mimeByName } from "../../domain/contract-files.rules";
import type { ChatUsecases } from "../application/chat.usecase";
import { ccError } from "./connect.errors";
import { whoOf } from "./connect.routes";

const UUID = z.uuid();
const MULTIPART_SLACK = 64 * 1024;
const tooLarge = () =>
  new AppError("MSG_FILE_TOO_LARGE", MSG_ERRORS.MSG_FILE_TOO_LARGE, "MSG_FILE_TOO_LARGE");
const badType = () => new AppError("MSG_FILE_TYPE", MSG_ERRORS.MSG_FILE_TYPE, "MSG_FILE_TYPE");
const storageOff = () => new AppError("FILE_STORAGE_UNAVAILABLE", 503, "FILE_STORAGE_UNAVAILABLE");

export function chatFilesRoutes(view: PackAccessView, uc: ChatUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const guard = packGuard(view, "contracts", "admin");

  r.post(
    "/connect/threads/:tenant_id/files",
    guard,
    bodyLimit({
      maxSize: ATTACH_MAX_BYTES + MULTIPART_SLACK,
      onError: () => Promise.reject(tooLarge()),
    }),
    async (c) => {
      const other = parseWith(UUID, c.req.param("tenant_id"));
      if (!uc.filesEnabled) throw storageOff();
      const form = await c.req.formData().catch(() => null);
      const file = form?.getAll("file").find((f): f is File => f instanceof Blob);
      if (!file) throw appError("VALIDATION_ERROR");
      if (file.size > ATTACH_MAX_BYTES) throw tooLarge();
      const name = cleanFileName(fileNameOf(file));
      const mime = mimeByName(name);
      if (!mime || file.size === 0) throw badType();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await uc.uploadFile(whoOf(c), other, { name, mime, bytes }).catch(ccError);
      return c.json({ file: out }, 200);
    },
  );

  r.get("/connect/files/:file_id", guard, async (c) => {
    const id = parseWith(UUID, c.req.param("file_id"));
    if (!uc.filesEnabled) throw storageOff();
    const url = await uc.fileLink(whoOf(c), id).catch(ccError);
    if (!url) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.redirect(url, 302);
  });
  return r;
}
