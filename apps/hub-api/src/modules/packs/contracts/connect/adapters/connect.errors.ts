// CR-161 · lát 5 (CR-169: bỏ mã trò chuyện) · lỗi hàm DEFINER ⇒ AppError (spec §3). SQLSTATE: CC422/CC409/CC404 = lỗi nghiệp vụ (MESSAGE = mã contract `CC_ERRORS`),
// 42501 = không có quyền/không thấy ⇒ 404 (không lộ công ty có tồn tại), 22023 = đầu vào sai ⇒ 400. Lỗi lạ ném lại (500).
import { CC_ERRORS, type CcErrorCode } from "@ai/contracts/pack-contracts";
import { AppError, appError } from "../../../../../lib/errors";

type PgErr = { code?: string; message?: string; cause?: PgErr };
const root = (e: unknown): PgErr => {
  let x = e as PgErr;
  while (x?.cause && typeof x.cause === "object") x = x.cause;
  return x ?? {};
};

const MESSAGES: Record<CcErrorCode, string> = {
  CONNECT_NOT_LISTED: "Công ty này chưa bật Danh bạ nên chưa nhận được lời mời kết nối.",
  CONNECT_DECLINED: "Bạn không thể gửi lại lời mời cho công ty này.",
  CONNECT_NOT_CONNECTED: "Hai công ty chưa kết nối.",
};
const isCode = (m: string | undefined): m is CcErrorCode =>
  m !== undefined && Object.hasOwn(CC_ERRORS, m);

/** `notFound`: mã (vẫn HTTP 404) thay cho `NOT_FOUND` chung khi 42501 — bài ⇒ `CONNECT_NOT_CONNECTED` theo spec §3. */
export function ccError(e: unknown, notFound?: CcErrorCode): never {
  if (e instanceof AppError) throw e;
  const { code, message } = root(e);
  if ((code === "CC422" || code === "CC409" || code === "CC404") && isCode(message))
    throw new AppError(message, CC_ERRORS[message], MESSAGES[message]);
  if (code === "42501") {
    if (notFound) throw new AppError(notFound, 404, MESSAGES[notFound]); // spec §3: bài ⇒ 404 (không lộ có/không), dù bảng mã nói 409
    throw appError("NOT_FOUND");
  }
  if (code === "22023") throw appError("VALIDATION_ERROR");
  throw e;
}
