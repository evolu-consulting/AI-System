// CR-127 · X3 · map `ExecFail` ⇒ mã lỗi contract (`EXEC_ERRORS`, câu VI: tasks §9) + `ExecWho` của request (quyền `admin` của gói = quản trị công ty).
// File lá của adapter (không import route khác) để `ledger.routes` / `milestones.routes` / `exec-requests.routes` cùng dùng mà không vòng import.
import { EXEC_ERRORS, type ExecErrorCode } from "@ai/contracts/pack-contracts";
import type { Context } from "hono";
import { AppError, appError } from "../../../../lib/errors";
import {
  checkPackAccess,
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
} from "../../kit/public";
import { ExecFail, type ExecFailKind, type ExecWho } from "../application/exec-request.usecase";

const KEY = "contracts";
const CODE: Record<Exclude<ExecFailKind, "not_found">, ExecErrorCode> = {
  hold_exists: "HOLD_EXISTS",
  not_held: "NOT_HELD",
  hold_not_allowed: "HOLD_NOT_ALLOWED",
  hold_forbidden: "HOLD_FORBIDDEN",
  change_forbidden: "CHANGE_FORBIDDEN",
  evidence_required: "EVIDENCE_REQUIRED",
  invalid: "CHANGE_INVALID",
  pending_exists: "CHANGE_PENDING_EXISTS",
};
export const EXEC_MESSAGES: Record<ExecErrorCode, string> = {
  HOLD_EXISTS: "Hợp đồng đang tạm khoá.",
  NOT_HELD: "Hợp đồng không bị tạm khoá.",
  HOLD_NOT_ALLOWED: "Chỉ tạm khoá được hợp đồng đã duyệt và còn hiệu lực.",
  HOLD_FORBIDDEN:
    "Chỉ người phụ trách, trưởng phòng của họ hoặc quản trị công ty được tạm khoá/mở khoá.",
  CHANGE_FORBIDDEN:
    "Chỉ người phụ trách hoặc quản trị công ty được yêu cầu thay đổi thực hiện của hợp đồng.",
  EVIDENCE_REQUIRED: "Cần ý kiến và chữ ký hoặc ít nhất một tệp.",
  CHANGE_INVALID:
    "Yêu cầu không áp dụng được cho mốc này (tách chỉ cho mốc tiền còn đủ số; “Miễn khoản phạt đã ghi” chỉ cho mốc phạt).",
  CHANGE_PENDING_EXISTS: "Mốc đang có yêu cầu thay đổi chờ duyệt.",
  USE_NEW_VERSION: "Đổi giá trị, đơn giá, các bên hoặc điều khoản cần Tải phiên bản mới.",
};

/** Lỗi Postgres (kể cả bọc trong `cause` của drizzle) ⇒ `{code, message}`; không phải ⇒ null. */
const pgErr = (e: unknown): { code?: string; message?: string } | null => {
  const x = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  return x?.cause?.code ? x.cause : x?.code ? x : null;
};
export const EVIDENCE_INVALID_MESSAGE =
  "Tệp hoặc chữ ký của bằng chứng không dùng được (không thuộc công ty này, đã bị dọn hoặc quá 10 MB). Tải lại tệp rồi thử lại.";

/** FIX-EV: `hub.record_evidence` từ chối (tệp/chữ ký công ty khác, quá cỡ, ý kiến sai — 42501/22023) ⇒ 422 có câu, không 500. */
function evidenceDbError(e: unknown): void {
  const p = pgErr(e);
  // "chưa đặt tenant/người dùng" = lỗi cấu hình phía server ⇒ giữ 500 (không đổ cho người dùng).
  if (!p?.message?.startsWith("record_evidence:") || p.message.includes("chưa đặt")) return;
  if (p.code === "42501" || p.code === "22023")
    throw new AppError("EVIDENCE_INVALID", 422, EVIDENCE_INVALID_MESSAGE);
}

/** `ExecFail` / lỗi ghi bằng chứng ⇒ AppError; lỗi khác ⇒ trả lại cho nơi gọi (ném tiếp). */
export function execError(e: unknown): void {
  evidenceDbError(e);
  if (!(e instanceof ExecFail)) return;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  const code = CODE[e.kind];
  throw new AppError(code, EXEC_ERRORS[code], EXEC_MESSAGES[code]);
}

export const useNewVersionError = (): never => {
  throw new AppError("USE_NEW_VERSION", EXEC_ERRORS.USE_NEW_VERSION, EXEC_MESSAGES.USE_NEW_VERSION);
};

/** Người gọi + có quyền `admin` của gói không (một lần mỗi request ghi). */
export async function execWho(view: PackAccessView, c: Context<PackGuardVars>): Promise<ExecWho> {
  const u = c.get("user");
  const i = await packAccessInput(view, KEY, u);
  const admin = checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
  return { tenantId: u.tenantId, userId: u.userId, admin };
}
