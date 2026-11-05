// CR-121 · R-2 · che secret trong dữ liệu debug (payload job, thông điệp lỗi gốc, nội dung đầu ra) trước khi trả cho
// platform_admin: khoá JSON khớp /secret|token|password|api_key|authorization|cookie/i ⇒ "***" (đệ quy), chuỗi có
// `Bearer …` / `khoá=giá trị` nhạy cảm ⇒ che phần giá trị. Thuần, lớp 1 (không I/O).
export const REDACTED = "***";
const SENSITIVE_KEY = /secret|token|password|api[_-]?key|authorization|cookie/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const KV_SECRET =
  /\b((?:[\w-]*(?:secret|token|password|api[_-]?key)[\w-]*)|authorization|cookie)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi;
const MAX_DEPTH = 12;

/** Che secret trong một chuỗi tự do (thông điệp lỗi, nội dung đầu ra). */
export function redactText(s: string): string {
  return s.replace(BEARER, `$1 ${REDACTED}`).replace(KV_SECRET, `$1$2${REDACTED}`);
}

/** Che đệ quy: khoá nhạy cảm ⇒ "***"; chuỗi ⇒ `redactText`; quá sâu ⇒ "***" (không để lọt cấu trúc lạ). */
export function redactJson(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redactText(v);
  if (v === null || typeof v !== "object") return v;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(v)) return v.map((x) => redactJson(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>))
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactJson(val, depth + 1);
  return out;
}
