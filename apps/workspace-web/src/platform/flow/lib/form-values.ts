// CR-118 · UW-FR-12 · cr118-flow-web · form của bước `form`: nháp thô của người dùng ⇒ giá trị gửi lên + lỗi từng trường. Thuần.
// Luật giá trị = `flowFormValuesSchema(form)` của contract (CÙNG validator Hub dùng ở snapshot): client chỉ báo lỗi sớm, Hub vẫn
// là nguồn thật (strict, bỏ trường lạ).
import {
  type FlowForm,
  type FlowFormField,
  type FlowFormValues,
  type FormPrefill,
  flowFormValuesSchema,
} from "@ai/contracts/flow";

/** Nháp: ô chữ/số/ngày/chọn = chuỗi thô, checkbox = boolean. */
export type FormDraft = Record<string, string | boolean>;
export type FieldErrorCode = "required" | "tooLong" | "range" | "integer" | "email" | "invalid";
export type FieldErrors = Record<string, FieldErrorCode>;
export type FormCheck = { ok: true; values: FlowFormValues } | { ok: false; errors: FieldErrors };

export const emptyDraft = (form: FlowForm): FormDraft =>
  Object.fromEntries(form.fields.map((f) => [f.key, f.type === "checkbox" ? false : ""]));

/** CR-126 · nháp ban đầu: trống ⇒ `default` của trường ⇒ giá trị máy chủ tính (`prefill.field_defaults`, thắng `default`). */
export function initialDraft(form: FlowForm, prefill?: FormPrefill): FormDraft {
  const draft = emptyDraft(form);
  for (const f of form.fields) {
    const raw = prefill?.field_defaults[f.key] ?? f.default;
    if (raw === undefined || raw === null) continue;
    if (f.type === "checkbox") draft[f.key] = raw === true || raw === "true";
    else if (typeof raw === "string" || typeof raw === "number") draft[f.key] = String(raw);
  }
  return draft;
}

export type SelectOption = { value: string; label: string };

/** CR-126 · lựa chọn của ô chọn: `options_from` ⇒ danh sách máy chủ cấp (`prefill.field_options`), còn lại ⇒ `options` của form. */
export function selectOptions(
  f: Extract<FlowFormField, { type: "select" }>,
  prefill?: FormPrefill,
): SelectOption[] {
  return f.options_from ? (prefill?.field_options[f.key] ?? []) : f.options;
}

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

/** CR-126 · lọc theo chữ gõ (không phân biệt hoa/thường và dấu) trên nhãn "tên · MST"; luôn giữ lựa chọn đang chọn. */
export function filterOptions(
  options: readonly SelectOption[],
  query: string,
  selected = "",
): SelectOption[] {
  const q = fold(query.trim());
  if (!q) return [...options];
  return options.filter((o) => o.value === selected || fold(o.label).includes(q));
}

/** Chuỗi số người nhập ⇒ số; không đọc được ⇒ giữ chuỗi để validator báo `invalid`. Tiền: bỏ dấu phân cách nghìn. */
function parseNumber(raw: string, money: boolean): number | string {
  const s = raw.trim();
  const n = Number(money ? s.replace(/[.,\s]/g, "") : s.replace(",", "."));
  return Number.isFinite(n) ? n : s;
}

/** Một trường: nháp ⇒ giá trị gửi; trống ⇒ null (trường tuỳ chọn trống bị bỏ khỏi thân). */
function fieldValue(f: FlowFormField, raw: string | boolean | undefined): unknown {
  if (f.type === "checkbox") return raw === true;
  const s = typeof raw === "string" ? raw : "";
  if (s.trim() === "") return null;
  if (f.type === "number" || f.type === "money") return parseNumber(s, f.type === "money");
  return f.type === "text" || f.type === "textarea" ? s : s.trim();
}

/** Mã lỗi của một issue zod trên trường `f` với giá trị đã chuyển `v`. */
function codeOf(f: FlowFormField, v: unknown, code: string): FieldErrorCode {
  if (v === null || v === undefined) return "required";
  if (f.type === "checkbox") return "required";
  if (code === "too_big" || code === "too_small")
    return f.type === "text" || f.type === "textarea" ? "tooLong" : "range";
  if (f.type === "text" && f.format === "email") return "email";
  if (f.type === "number" && f.integer && typeof v === "number" && !Number.isInteger(v))
    return "integer";
  return "invalid";
}

export function checkForm(form: FlowForm, draft: FormDraft): FormCheck {
  const raw: Record<string, unknown> = {};
  for (const f of form.fields) raw[f.key] = fieldValue(f, draft[f.key]);
  const res = flowFormValuesSchema(form).safeParse(raw);
  if (res.success) {
    const values: FlowFormValues = {};
    for (const [k, v] of Object.entries(res.data as Record<string, unknown>))
      if (v !== null && v !== undefined) values[k] = v as FlowFormValues[string];
    return { ok: true, values };
  }
  const errors: FieldErrors = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0];
    const f = typeof key === "string" ? form.fields.find((x) => x.key === key) : undefined;
    if (f && !errors[f.key]) errors[f.key] = codeOf(f, raw[f.key], issue.code);
  }
  return { ok: false, errors };
}
