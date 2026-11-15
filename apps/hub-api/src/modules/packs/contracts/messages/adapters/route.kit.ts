// CR-132/169 · phần dùng chung của route tin nhắn (nội bộ + `partner`): lỗi chuẩn, `run` (MsgFail / lỗi hàm DB `pmsg_*` ⇒ AppError), guard `read` + người gọi (external ⇒ 403) + tham số uuid.
import { MSG_ERRORS } from "@ai/contracts/pack-contracts";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../../../lib/errors";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../../kit/public";
import { MsgFail } from "../application/messages.usecase";
import { pmsgError } from "./partner.errors";

export const notFound = () =>
  new AppError("MSG_NOT_FOUND", MSG_ERRORS.MSG_NOT_FOUND, "MSG_NOT_FOUND");
export const forbidden = () => new AppError("PACK_FORBIDDEN", 403, "Forbidden");
/** `MsgFail` ⇒ AppError(mã, HTTP theo `MSG_ERRORS`); lỗi hàm DB `pmsg_*` (CC*, 42501) ⇒ `pmsgError`. */
export const run = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (e instanceof MsgFail) throw new AppError(e.code, MSG_ERRORS[e.code], e.code);
    return pmsgError(e);
  });
export const SeqSchema = z.coerce.number().int().min(1);
export const MULTIPART_SLACK = 64 * 1024;
export const tooLarge = () =>
  new AppError("MSG_FILE_TOO_LARGE", MSG_ERRORS.MSG_FILE_TOO_LARGE, "MSG_FILE_TOO_LARGE");
export const storageOff = () =>
  new AppError("FILE_STORAGE_UNAVAILABLE", 503, "FILE_STORAGE_UNAVAILABLE");

export type Routes = Hono<PackGuardVars>;
export type Ctx = Context<PackGuardVars>;
/** Phần dùng chung của mọi route: guard `read`, người gọi (đối tác ⇒ 403), tham số uuid, no-store. */
export type H = ReturnType<typeof helpers>;
export function helpers(view: PackAccessView) {
  const who = (c: Ctx) => {
    const u = c.get("user");
    if (u.userKind === "external") throw forbidden(); // đối tác không nhắn tin nội bộ
    return { tenantId: u.tenantId, userId: u.userId, userKind: u.userKind };
  };
  const uuid = (c: Ctx, name: string) => {
    const v = z.uuid().safeParse(c.req.param(name));
    if (!v.success) throw notFound();
    return v.data;
  };
  const noStore = (c: Ctx) => c.header("cache-control", "no-store");
  return { read: packGuard(view, "contracts", "read"), who, uuid, noStore };
}
