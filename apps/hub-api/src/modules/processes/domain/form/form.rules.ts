// CR-118 · cr118-form-node · node `form`: luật THUẦN (lớp 1, không I/O) — kiểm giá trị người dùng gửi theo trường form
// trong SNAPSHOT run (không theo def hiện hành), bỏ trường lạ, chuẩn hoá về scalar (string|number) để If/bước sau đọc.
// Không ép kiểu lỏng: số phải là số JSON, checkbox phải là boolean.
import {
  FORM_EMAIL_MAX,
  FORM_EMAIL_RE,
  FORM_OUTPUT_TYPE,
  type FormField,
  isIsoCalendarDate,
} from "@ai/contracts/hub-admin";

export type FormValue = string | number;
export type FormValues = Record<string, FormValue>;
export type FormCheck = { ok: true; values: FormValues } | { ok: false; paths: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Có ký tự điều khiển (C0 + DEL); `multi` (textarea) cho phép `\t` và `\n`. */
function hasCtrl(s: string, multi: boolean): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 || c === 0x7f) && !(multi && (c === 0x09 || c === 0x0a))) return true;
  }
  return false;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Giá trị "vắng": undefined/null/chuỗi rỗng sau trim. */
const absent = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function inRange(n: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || n >= min) && (max === undefined || n <= max);
}

type Of<T extends FormField["type"]> = Extract<FormField, { type: T }>;
type Check = (f: FormField, v: unknown) => FormValue | undefined;

function text(f: Of<"text"> | Of<"textarea">, v: unknown): FormValue | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > f.max_len || hasCtrl(s, f.type === "textarea")) return undefined;
  // CR-126 · ô email (`format: "email"`): cùng luật với giao diện.
  if (
    f.type === "text" &&
    f.format === "email" &&
    (s.length > FORM_EMAIL_MAX || !FORM_EMAIL_RE.test(s))
  )
    return undefined;
  return s;
}
/** CR-126 · danh sách do máy chủ cấp (`options_from`): `options` trống ⇒ nhận chuỗi gọn; tool của gói kiểm lại thuộc danh sách thật. */
const PREFILL_VALUE_MAX = 200;
function select(f: Of<"select">, v: unknown): FormValue | undefined {
  if (typeof v !== "string") return undefined;
  if (!f.options_from) return f.options.some((o) => o.value === v) ? v : undefined;
  const s = v.trim();
  return s.length > 0 && s.length <= PREFILL_VALUE_MAX && !hasCtrl(s, false) ? s : undefined;
}
function num(f: Of<"number">, v: unknown): FormValue | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (f.integer && !Number.isInteger(v)) return undefined;
  return inRange(v, f.min, f.max) ? v : undefined;
}
function money(f: Of<"money">, v: unknown): FormValue | undefined {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) return undefined;
  return inRange(v, f.min, f.max) ? v : undefined;
}
const str = (v: unknown, ok: (s: string) => boolean): string | undefined =>
  typeof v === "string" && ok(v) ? v : undefined;

/** Một trường đã có giá trị (không vắng) ⇒ giá trị chuẩn hoá, sai ⇒ undefined. Bảng đủ loại (thiếu ⇒ lỗi typecheck). */
const CHECKS: {
  readonly [K in FormField["type"]]: (f: Of<K>, v: unknown) => FormValue | undefined;
} = {
  text,
  textarea: text,
  number: num,
  money,
  date: (_f, v) => str(v, isIsoCalendarDate),
  select,
  checkbox: (_f, v) => (typeof v === "boolean" ? String(v) : undefined),
  file_ref: (_f, v) => str(v, (s) => UUID_RE.test(s))?.toLowerCase(),
};
const one = (f: FormField, v: unknown): FormValue | undefined => (CHECKS[f.type] as Check)(f, v);

/**
 * Kiểm `raw` theo `fields` (của snapshot). Trường lạ bị bỏ; trường không bắt buộc vắng bị bỏ; checkbox bắt buộc phải
 * `true`. Kết quả theo THỨ TỰ trường (để `canonicalFormValues` ổn định cho idempotent).
 */
export function validateFormValues(fields: readonly FormField[], raw: unknown): FormCheck {
  const src = isObj(raw) ? raw : {};
  const values: FormValues = {};
  const paths: string[] = [];
  for (const f of fields) {
    const v = Object.hasOwn(src, f.key) ? src[f.key] : undefined;
    if (absent(v)) {
      if (f.required) paths.push(f.key);
      continue;
    }
    const out = one(f, v);
    if (out === undefined || (f.type === "checkbox" && f.required && out !== "true"))
      paths.push(f.key);
    else values[f.key] = out;
  }
  return paths.length > 0 ? { ok: false, paths } : { ok: true, values };
}

/** CR-125 · id tệp (chữ thường, không trùng) của các ô `file_ref` trong giá trị đã chuẩn hoá. */
export function fileRefIds(fields: readonly FormField[], values: Readonly<FormValues>): string[] {
  const ids = fields
    .filter((f) => f.type === "file_ref")
    .map((f) => values[f.key])
    .filter((v): v is string => typeof v === "string");
  return [...new Set(ids)];
}

/** Chuỗi so sánh idempotent (giữ thứ tự khoá do `validateFormValues` dựng). */
export const canonicalFormValues = (v: FormValues): string => JSON.stringify(v);

/** `output.fields` của stage form (Hub ép khi lưu def): kiểu theo `FORM_OUTPUT_TYPE`, không bắt buộc (chờ người điền). */
export const formOutputFields = (
  fields: readonly FormField[],
): { key: string; type: "string" | "number" | "date"; required: boolean }[] =>
  fields.map((f) => ({ key: f.key, type: FORM_OUTPUT_TYPE[f.type], required: false }));
