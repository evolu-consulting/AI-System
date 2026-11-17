// CR-181 · lỗi nghiệp vụ khi in chữ ký lên PDF (route s8 đổi `code` → HTTP status).
export const SIGN_ERROR_CODES = [
  "SIGN_OUTSIDE_PAGE",
  "SIGN_PAGE_NOT_FOUND",
  "SIGN_PARTS_INVALID",
  "SIGN_PDF_ENCRYPTED",
  "SIGN_PDF_INVALID",
  "SIGN_TOO_MANY_PAGES",
  "SIGN_IMAGE_INVALID",
  "SIGN_IMAGE_TOO_LARGE",
  "DIGITAL_SIGN_NOT_ENABLED",
] as const;
export type SignErrorCode = (typeof SIGN_ERROR_CODES)[number];

export class SignError extends Error {
  constructor(
    readonly code: SignErrorCode,
    readonly detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SignError";
  }
}
