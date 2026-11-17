// CR-181 · lỗi nghiệp vụ của chữ ký nội bộ (lớp 1, thuần): mã + HTTP status. Adapter route đổi sang `AppError` ở biên.
export type SignatureErrorStatus = 403 | 404 | 409 | 413 | 415 | 422;

export class SignatureError extends Error {
  constructor(
    readonly code: string,
    readonly status: SignatureErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "SignatureError";
  }
}
