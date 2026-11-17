// CR-181 · s8 phần A · «Ký trên tài liệu» (mount dưới `/pack/contracts`, khuôn `contract-files.routes.ts`):
//   PATCH /contracts/:id/sign-docs/:fileId          {needs_sign}  — BR-T1, Q13
//   PUT   /contracts/:id/sign-docs/:fileId/fields   {fields[]}    — BR-C1/C2
//   GET   /contracts/:id/signers                                  — người ký Bên A + Bên B (Q2)
//   GET   /contracts/:id/doc-sign-session                         — phiên chuẩn bị/ký/xem (KHÔNG dùng `/sign-session`: đã là phiên ký chung CR-127)
// Guard `read`/`write` TRƯỚC khi đọc tham số/thân; HĐ không thấy / công ty khác ⇒ 404 cùng thân. Quyền người tải lên kiểm trong use case cùng tx.
import { SignFieldsPutSchema, SignNeedsSignBodySchema } from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { SignDocFail, type SignDocUsecases } from "../application/sign-doc.usecase";

const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};

const ISSUE_MSG: Record<string, string> = {
  SIGN_NOT_PDF: "Chỉ tệp PDF mới ký được — đổi sang PDF rồi tải lại",
  SIGN_PDF_ENCRYPTED: "Tệp PDF có mật khẩu — bỏ mật khẩu rồi tải lại",
  SIGN_PDF_INVALID: "Không đọc được tệp PDF này — tải lại bản khác",
  SIGN_TOO_MANY_PAGES: "Tệp quá 50 trang — tách nhỏ rồi tải lại",
  SIGN_FIELDS_TOO_MANY: "Quá nhiều chỗ ký trên một tệp",
  SIGN_SIGNER_UNKNOWN: "Chỗ ký phải gán cho một người ký của hợp đồng",
  SIGN_PAGE_NOT_FOUND: "Chỗ ký nằm ngoài các trang của tệp",
};

/** Lỗi nghiệp vụ → HTTP (đường dẫn duy nhất; test đơn vị cũng dùng). */
export function signDocHttp(e: SignDocFail): AppError {
  switch (e.kind) {
    case "not_found":
      return appError("NOT_FOUND");
    case "forbidden":
      return new AppError("PACK_FORBIDDEN", 403, "Forbidden");
    case "locked":
      return new AppError(
        "CONTRACT_NOT_DRAFT",
        409,
        "Contract is no longer a draft — signing setup is locked",
      );
    case "off":
      return new AppError("SIGN_ON_DOC_OFF", 409, "Ký trên tài liệu chưa được bật cho công ty");
    case "not_needed":
      return new AppError("SIGN_FILE_NOT_NEEDED", 409, "Tệp này chưa được đánh dấu «Cần ký»");
    case "issue":
      return new AppError(e.code, 422, ISSUE_MSG[e.code] ?? e.code);
  }
}

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    throw e instanceof SignDocFail ? signDocHttp(e) : e;
  });

export function signDocRoutes(view: PackAccessView, uc: SignDocUsecases): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, "contracts", "read");
  const write = packGuard(view, "contracts", "write");
  const id = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("id"));
  const fid = (c: Context<PackGuardVars>) => parseWith(z.uuid(), c.req.param("fileId"));

  r.patch("/contracts/:id/sign-docs/:fileId", write, async (c) => {
    const body = parseWith(SignNeedsSignBodySchema, await readJson(c));
    return c.json(await run(uc.setNeedsSign(who(c), id(c), fid(c), body.needs_sign)));
  });
  r.put("/contracts/:id/sign-docs/:fileId/fields", write, async (c) => {
    const body = parseWith(SignFieldsPutSchema, await readJson(c));
    return c.json(await run(uc.putFields(who(c), id(c), fid(c), body.fields)));
  });
  r.get("/contracts/:id/signers", read, async (c) => {
    const out = await run(uc.signers(who(c), id(c)));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  r.get("/contracts/:id/doc-sign-session", read, async (c) => {
    const out = await run(uc.session(who(c), id(c)));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  return r;
}
