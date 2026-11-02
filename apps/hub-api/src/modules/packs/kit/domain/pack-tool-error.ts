// CR-107 · lỗi NGHIỆP VỤ của tool gói (sai trạng thái, thiếu bước bắt buộc…): registry trả mã riêng (không `UPSTREAM_ERROR`) ⇒ engine
// phân loại `business` (CR-083 thử lại theo loại lỗi) ⇒ `needs_decision` ngay, không thử lại ~10,5'. Lỗi khác (DB, mạng, hết hạn)
// vẫn là `UPSTREAM_ERROR` (thử lại). Thuần, lớp 1.

/** Mã lỗi nghiệp vụ mặc định của tool gói (∉ {UPSTREAM_ERROR, TIMEOUT} ⇒ `classifyToolError` = business). */
export const PACK_TOOL_BUSINESS = "PACK_TOOL_BUSINESS";

export class PackToolBusinessError extends Error {
  readonly code: string;
  constructor(message: string, code: string = PACK_TOOL_BUSINESS) {
    super(message);
    this.name = "PackToolBusinessError";
    this.code = code;
  }
}

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Lỗi ném từ tool ⇒ mã kết quả: lỗi nghiệp vụ ⇒ mã của nó (dạng hợp lệ, ≠ mã tạm thời); còn lại ⇒ `UPSTREAM_ERROR`. */
export function packToolErrorCode(err: unknown): string {
  if (!(err instanceof PackToolBusinessError)) return "UPSTREAM_ERROR";
  const ok = CODE.test(err.code) && err.code !== "UPSTREAM_ERROR" && err.code !== "TIMEOUT";
  return ok ? err.code : PACK_TOOL_BUSINESS;
}
