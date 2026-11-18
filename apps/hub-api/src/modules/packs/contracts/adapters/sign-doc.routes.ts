// CR-181 · s8 phần A · «Ký trên tài liệu» (mount dưới `/pack/contracts`, khuôn `contract-files.routes.ts`):
//   PATCH /contracts/:id/sign-docs/:fileId          {needs_sign}  — BR-T1, Q13
//   PUT   /contracts/:id/sign-docs/:fileId/fields   {fields[]}    — BR-C1/C2
//   GET   /contracts/:id/signers                                  — người ký Bên A + Bên B (Q2)
//   POST  /contracts/:id/sign-docs/:fileId/sign     {kind, marks[]} — Lưu chữ ký (phần B; quyền = lượt ký qua `SignTurnPort`, không cần quyền ghi gói)
//   GET   /contracts/:id/sign-docs/:fileId/versions — các bản + chỗ ký còn chờ (X1)
//   GET   /contracts/:id/sign-docs/:fileId/content, /versions/:vid/content — PDF inline (bản gốc / một bản)
//   GET   /contracts/:id/doc-sign-session                         — phiên chuẩn bị/ký/xem (KHÔNG dùng `/sign-session`: đã là phiên ký chung CR-127)
// Guard `read`/`write` TRƯỚC khi đọc tham số/thân; HĐ không thấy / công ty khác ⇒ 404 cùng thân. Quyền người tải lên kiểm trong use case cùng tx.
import {
  SignFieldsPutSchema,
  SignNeedsSignBodySchema,
  SignSaveBodySchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import { SignDocFail, type SignDocUsecases } from "../application/sign-doc.usecase";
import type { SignSaveUsecases } from "../application/sign-save.usecase";
import { isResendAdmin } from "./partner-sign.admin";

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
  SIGN_MARK_INVALID: "Dấu chữ ký không hợp lệ (ô ký phải đi kèm đúng kiểu dấu)",
  SIGN_OUTSIDE_PAGE: "Chữ ký nằm ngoài trang",
  SIGN_PARTS_INVALID: "Vị trí chữ ký không hợp lệ",
  SIGN_IMAGE_INVALID: "Ảnh chữ ký không hợp lệ — tạo lại chữ ký",
  SIGN_IMAGE_TOO_LARGE: "Ảnh chữ ký quá lớn — tạo lại chữ ký",
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
    case "digital":
      return new AppError("DIGITAL_SIGN_NOT_ENABLED", 409, "Công ty chưa bật chữ ký số");
    case "signature_missing":
      return new AppError("SIGNATURE_MISSING", 409, "Bạn chưa có chữ ký — tạo chữ ký rồi ký lại");
    case "stale":
      return new AppError(
        "SIGN_VERSION_STALE",
        409,
        "Có người vừa lưu bản mới của tệp này — mở lại để ký trên bản mới nhất",
      );
    case "issue":
      return new AppError(e.code, 422, ISSUE_MSG[e.code] ?? e.code);
  }
}

const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    throw e instanceof SignDocFail ? signDocHttp(e) : e;
  });

export function signDocRoutes(
  view: PackAccessView,
  uc: SignDocUsecases,
  save: SignSaveUsecases,
): Hono<PackGuardVars> {
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
  r.post("/contracts/:id/sign-docs/:fileId/sign", read, async (c) => {
    const body = parseWith(SignSaveBodySchema, await readJson(c));
    return c.json(await run(save.sign(who(c), id(c), fid(c), body)), 201);
  });
  r.get("/contracts/:id/sign-docs/:fileId/versions", read, async (c) => {
    const out = await run(save.versions(who(c), id(c), fid(c)));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  const pdf = async (c: Context<PackGuardVars>, vid: string | null) => {
    const out = await run(save.content(who(c), id(c), fid(c), vid));
    if (!out) throw appError("NOT_FOUND");
    c.header("content-type", "application/pdf");
    c.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(out.name)}`);
    c.header("cache-control", "private, no-store");
    return c.body(out.bytes as Uint8Array<ArrayBuffer>);
  };
  r.get("/contracts/:id/sign-docs/:fileId/content", read, (c) => pdf(c, null));
  r.get("/contracts/:id/sign-docs/:fileId/versions/:vid/content", read, (c) =>
    pdf(c, parseWith(z.uuid(), c.req.param("vid"))),
  );
  r.get("/contracts/:id/signers", read, async (c) => {
    const out = await run(uc.signers(who(c), id(c)));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  r.get("/contracts/:id/doc-sign-session", read, async (c) => {
    const out = await run(uc.session(who(c), id(c), await isResendAdmin(view, c)));
    if (!out) throw appError("NOT_FOUND");
    c.header("cache-control", "no-store");
    return c.json(out);
  });
  return r;
}
