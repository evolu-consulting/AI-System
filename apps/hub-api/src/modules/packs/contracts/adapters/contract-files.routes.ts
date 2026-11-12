// CR-133 · «Tài liệu kèm» trên HĐ (mount dưới `/pack/contracts`): `GET /contracts/:id/files` (hai nhóm trong một khối), `POST /contracts/:id/files`
// (multipart `file`), `DELETE /contracts/:id/files/:fileId`, `GET /contracts/:id/files/:fileId/link` (link tải ngắn hạn, JSON — trình duyệt mở tab
// không mang Bearer). Guard `read` (xem/tải) / `write` (gắn/gỡ) TRƯỚC khi đọc tham số/thân; HĐ không thấy / tenant khác ⇒ 404 cùng thân. Quyền sửa HĐ
// theo vai (`contractRoleOf`) + người tạo/phụ trách, kiểm lại trong use case cùng tx.
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import {
  ContractFilesFail,
  type ContractFilesUsecases,
} from "../application/contract-files.usecase";
import { acceptedExtensions } from "../domain/contract-files.rules";
import type { DeleteRole } from "../domain/delete-contract.rules";
import { cleanFileName, fileNameOf } from "./upload.routes";

const MULTIPART_SLACK = 64 * 1024;
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};
const tooLarge = () => new AppError("FILE_TOO_LARGE", 413, "File too large");

/** Lỗi nghiệp vụ → HTTP. 415 nói rõ định dạng nhận được (người dùng biết đổi sang gì). */
const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (!(e instanceof ContractFilesFail)) throw e;
    if (e.kind === "not_found") throw appError("NOT_FOUND");
    if (e.kind === "forbidden") throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    if (e.kind === "full")
      throw new AppError("CONTRACT_FILES_FULL", 409, "Too many attached files on this contract");
    throw new AppError(
      "FILE_TYPE",
      415,
      `Định dạng chưa nhận — chỉ nhận ${acceptedExtensions()}. Hãy lưu sang một trong các định dạng này rồi thêm lại`,
    );
  });

export function contractFilesRoutes(
  view: PackAccessView,
  uc: ContractFilesUsecases,
  roleOf: (w: { tenantId: string; userId: string }) => Promise<DeleteRole>,
  maxBytes: number,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, "contracts", "read");
  const write = packGuard(view, "contracts", "write");
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
  const fid = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("fileId"));

  r.get("/contracts/:id/files", read, async (c) => {
    const w = who(c);
    const out = await uc.list(w, id(c), await roleOf(w));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  r.post(
    "/contracts/:id/files",
    write,
    bodyLimit({ maxSize: maxBytes + MULTIPART_SLACK, onError: () => Promise.reject(tooLarge()) }),
    async (c) => {
      const cid = id(c);
      const form = await c.req.formData().catch(() => null);
      const file = form?.getAll("file").find((f): f is File => f instanceof Blob);
      if (!file) throw appError("VALIDATION_ERROR");
      if (file.size > maxBytes) throw tooLarge();
      // Tệp rỗng ⇒ 415 như tải HĐ (không lưu tệp 0 byte).
      const name = cleanFileName(fileNameOf(file));
      const w = who(c);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength === 0) throw new AppError("FILE_TYPE", 415, "Empty file");
      return c.json(await run(uc.add(w, cid, await roleOf(w), { name, bytes })), 201);
    },
  );
  r.delete("/contracts/:id/files/:fileId", write, async (c) => {
    const w = who(c);
    await run(uc.remove(w, id(c), fid(c), await roleOf(w)));
    return c.body(null, 204);
  });
  r.get("/contracts/:id/files/:fileId/link", read, async (c) => {
    const url = await uc.link(who(c), id(c), fid(c));
    if (!url) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json({ url });
  });
  return r;
}
