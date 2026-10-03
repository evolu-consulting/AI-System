// ADM-FR-08 · mã TOTP 6 số: lọc ký tự, độ dài (hàm thuần cho OtpInput).
export const OTP_LENGTH = 6;

/** Chỉ giữ chữ số (dán "123 456" cũng được), cắt ở 6. */
export function sanitizeOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export const isOtpComplete = (v: string): boolean => v.length === OTP_LENGTH;
