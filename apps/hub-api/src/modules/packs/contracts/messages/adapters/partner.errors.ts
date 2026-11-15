// CR-169 · lát 3a · lỗi hàm DEFINER `hub.pmsg_*` ⇒ AppError (spec §4). SQLSTATE `CC404/CC403/CC409/CC422` = lỗi nghiệp vụ, MESSAGE = mã `MSG_ERRORS` (HTTP theo bảng);
// `CC400` (MSG_EMPTY/MSG_TOO_LONG/MSG_TOO_MANY_FILES) và `22023` (đầu vào sai) ⇒ 400; `42501` (không có quyền Sổ Hợp Tác / không được dùng) ⇒ 403 `PACK_FORBIDDEN`.
// Lỗi lạ ném lại (500). Công ty thứ ba / không là đầu cuộc: DB trả `CC404` ⇒ cùng 404 `MSG_NOT_FOUND` (không lộ).
import { MSG_ERRORS, type MsgErrorCode } from "@ai/contracts/pack-contracts";
import { AppError, appError } from "../../../../../lib/errors";

type PgErr = { code?: string; message?: string; cause?: PgErr };
const root = (e: unknown): PgErr => {
  let x = e as PgErr;
  while (x?.cause && typeof x.cause === "object") x = x.cause;
  return x ?? {};
};
const isCode = (m: string | undefined): m is MsgErrorCode =>
  m !== undefined && Object.hasOwn(MSG_ERRORS, m);

export function pmsgError(e: unknown): never {
  if (e instanceof AppError) throw e;
  const { code, message } = root(e);
  if (
    (code === "CC404" || code === "CC403" || code === "CC409" || code === "CC422") &&
    isCode(message)
  )
    throw new AppError(message, MSG_ERRORS[message], message);
  if (code === "CC400" || code === "22023") throw appError("VALIDATION_ERROR");
  if (code === "42501") throw new AppError("PACK_FORBIDDEN", 403, "Forbidden");
  throw e;
}
