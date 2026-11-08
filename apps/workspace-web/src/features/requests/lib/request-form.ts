// CR-125 · cr125-manual-start-ui · phiếu yêu cầu dựng từ schema `form.fields` của flow: giá trị ban đầu, kiểm tại chỗ, đổi sang `values` gửi
// hub, và câu lỗi theo MÃ (không lộ mã kỹ thuật). Thuần — test bằng unit.
import type { StartableFlow } from "@ai/contracts/hub-admin";

export type RField = StartableFlow["form"]["fields"][number];
/** Giá trị ô khi nhập: chuỗi (chữ/ngày/tiền/phòng ban) hoặc mảng id (người, tệp). */
export type RValue = string | string[];
export type RValues = Record<string, RValue>;

export const isList = (t: string): boolean => t === "people" || t === "attachments";

export const initialValues = (fields: readonly RField[]): RValues =>
  Object.fromEntries(fields.map((f) => [f.key, isList(f.type) ? [] : ""]));

const empty = (v: RValue | undefined): boolean =>
  v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === "");

/** Mã lỗi theo ô (khoá i18n `contracts.requests.err.<mã>`); rỗng ⇒ hợp lệ. */
export function validate(fields: readonly RField[], values: RValues): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (empty(v)) {
      if (f.required) e[f.key] = "required";
    } else if (f.type === "money" && (Number.isNaN(Number(v)) || Number(v) < 0)) e[f.key] = "money";
  }
  return e;
}

/** Giá trị gửi hub: ô trống bỏ; tiền ⇒ số; danh sách giữ mảng. */
export function toPayload(fields: readonly RField[], values: RValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (empty(v)) continue;
    out[f.key] = f.type === "money" ? Number(v) : Array.isArray(v) ? v : (v as string).trim();
  }
  return out;
}

/** Lỗi 422 `START_FORM_INVALID` (`details.fields = {khoá: mã zod}`) ⇒ mã nghiệp vụ theo ô. */
export function fieldErrorsOf(details: unknown): Record<string, string> {
  const raw = (details as { fields?: Record<string, string> } | null | undefined)?.fields ?? {};
  const map: Record<string, string> = {
    required_or_type: "required",
    too_small: "required",
    too_big: "tooBig",
    invalid_format: "format",
    invalid_type: "required",
    unrecognized: "unknown",
  };
  return Object.fromEntries(Object.entries(raw).map(([k, c]) => [k, map[c] ?? "invalid"]));
}

/** Mã lỗi API ⇒ khoá i18n câu nói theo ngôn ngữ nghiệp vụ (`contracts.requests.err.<mã>`); mã lạ ⇒ câu chung. */
const KNOWN = new Set([
  "START_NOT_ALLOWED",
  "START_FORM_INVALID",
  "START_FLOW_OFF",
  "START_REQUEST_REUSED",
  "TOO_MANY_PROCESS_RUNS",
  "PROCESS_NOT_FOUND",
]);
export const startErrorKey = (code: string): string =>
  `contracts.requests.err.${KNOWN.has(code) ? code : "generic"}`;
