// Lỗi API ⇒ khoá i18n nghiệp vụ (không lộ mã kỹ thuật).
const KNOWN = ["DIGITAL_SIGN_NOT_ENABLED", "SIGNATURE_MISSING"];
export function signErrorKey(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? "";
  return `contracts.docsign.err.${KNOWN.includes(code) ? code : "generic"}`;
}
