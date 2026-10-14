// ADM-FR-68 · FS4 · mã lỗi server → CÂU TĨNH (không dùng `message` server). Hàm thuần, test cạnh file.
import { SOURCE_ERRORS } from "@ai/contracts/hub-admin";
import { ApiError } from "@/lib/http";
import { fieldFromIssues, type SourceField } from "./schemas";

const P = "process.sources.apiError";

export type SourceRef = { process_key: string; stage_key: string };

/** `ApiError.code` là mã nguồn đã biết (SOURCE_*)? */
const isSourceCode = (code: string): boolean => Object.hasOwn(SOURCE_ERRORS, code);

/** Khoá i18n cho lỗi; mã không biết / mạng / 5xx ⇒ câu chung. `VALIDATION_ERROR` do nơi gọi map theo ô trước. */
export function sourceErrorKey(err: unknown): string {
  if (err instanceof ApiError && isSourceCode(err.code)) return `${P}.${err.code}`;
  return `${P}.GENERIC`;
}

/** Ô nhận lỗi theo mã (null ⇒ hiện ở `alert` của drawer). */
export function fieldForCode(code: string): SourceField | null {
  if (code === "SOURCE_KEY_TAKEN") return "key";
  if (code === "SOURCE_HOST_NOT_ALLOWED") return "url";
  if (code === "SOURCE_CREDENTIAL_INVALID") return "credential_secret_id";
  if (code === "SOURCE_APPLY_UNSUPPORTED") return "apply_mode";
  return null;
}

/** `ApiError` có mã `code` (mã SOURCE_* nằm ngoài union `ApiErrorCode` của http.ts). */
export const hasCode = (err: unknown, code: string): boolean =>
  err instanceof ApiError && (err.code as string) === code;

export const errorCodeOf = (err: unknown): string | null =>
  err instanceof ApiError ? err.code : null;

export const isAbort = (err: unknown): boolean =>
  err instanceof DOMException && err.name === "AbortError";

/** `details.refs` của 409 `SOURCE_IN_USE` → danh sách (bỏ phần tử sai dạng). */
export function refsFromDetails(details: unknown): SourceRef[] {
  const refs = (details as { refs?: unknown } | null | undefined)?.refs;
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((r) => {
    const x = r as { process_key?: unknown; stage_key?: unknown } | null;
    return typeof x?.process_key === "string" && typeof x.stage_key === "string"
      ? [{ process_key: x.process_key, stage_key: x.stage_key }]
      : [];
  });
}

/** Kết quả kiểm tra thất bại do hết thời gian chờ phía client (mạng/abort do timeout) hay Hub trả lỗi. */
export const isTimeout = (err: unknown): boolean =>
  err instanceof ApiError && (err.code === "NETWORK_ERROR" || err.status === 504);

const C = "process.sources.credential";

/** `details.used_by` (409 SECRET_IN_USE) hoặc `used_by` của HubSecret → số nguồn đang dùng. */
export function sourceUsedByCount(usedBy: { type: string }[] | undefined): number {
  return (usedBy ?? []).filter((u) => u.type === "source").length;
}

export type CredentialFailure =
  | { type: "field"; field: "name" | "value"; key: string }
  | { type: "alert"; key: string }
  | { type: "conflict" };

/** Lỗi tạo/thay khoá → ô (tên/token) hoặc alert. Câu tĩnh theo mã (không in `message` server). */
export function classifyCredentialError(err: unknown): CredentialFailure {
  if (!(err instanceof ApiError)) return { type: "alert", key: `${C}.err.name` };
  if (err.code === "VALIDATION_ERROR") {
    const path = (err.details as { issues?: { path?: unknown[] }[] } | null)?.issues?.[0]
      ?.path?.[0];
    if (path === "name") return { type: "field", field: "name", key: `${C}.err.name` };
    if (path === "value") return { type: "field", field: "value", key: `${C}.err.valueLen` };
  }
  if (hasCode(err, "SECRET_NAME_TAKEN"))
    return { type: "field", field: "name", key: `${C}.err.taken` };
  if (hasCode(err, "VERSION_CONFLICT")) return { type: "conflict" };
  return { type: "alert", key: sourceErrorKey(err) };
}

export type SaveFailure =
  | { type: "ignore" }
  | { type: "gone" }
  | { type: "field"; field: SourceField; key: string; params?: { key: string } }
  | { type: "alert"; key: string };

/** Lỗi lưu (POST/PUT) → nơi hiện: bỏ qua (phiên hết hạn), nguồn đã mất, một ô (kèm tham số), hoặc `alert` trong drawer. */
export function classifySaveError(err: unknown, formKey: string): SaveFailure {
  if (!(err instanceof ApiError)) return { type: "alert", key: sourceErrorKey(err) };
  if (err.code === "UNAUTHORIZED") return { type: "ignore" };
  if (hasCode(err, "SOURCE_NOT_FOUND")) return { type: "gone" };
  const issue = err.code === "VALIDATION_ERROR" ? fieldFromIssues(err.details) : null;
  if (issue) return { type: "field", field: issue.field, key: issue.key };
  const field = fieldForCode(err.code);
  if (field) return { type: "field", field, key: sourceErrorKey(err), params: { key: formKey } };
  const conflict = hasCode(err, "VERSION_CONFLICT");
  return { type: "alert", key: conflict ? "errors.versionConflict" : sourceErrorKey(err) };
}
