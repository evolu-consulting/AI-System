// Lỗi API ⇒ khoá i18n nghiệp vụ (không lộ mã kỹ thuật). Mỗi mã có câu riêng: lý do + việc cần làm.
export const SIGN_ERR_CODES = [
  "DIGITAL_SIGN_NOT_ENABLED",
  "SIGNATURE_MISSING",
  "SIGN_VERSION_STALE",
  "PACK_FORBIDDEN",
  "SIGN_ON_DOC_OFF",
  "SIGN_OUTSIDE_PAGE",
  "SIGN_MARK_INVALID",
  "SIGNATURE_TOO_LARGE",
  "SIGN_PDF_ENCRYPTED",
  "SIGN_TOO_MANY_PAGES",
  "SIGN_NOT_PDF",
  "SIGN_REQUIRED",
] as const;
export const isStaleVersion = (e: unknown): boolean =>
  (e as { code?: string } | null)?.code === "SIGN_VERSION_STALE";
export function signErrorKey(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? "";
  const known = (SIGN_ERR_CODES as readonly string[]).includes(code);
  return `contracts.docsign.err.${known ? code : "generic"}`;
}
