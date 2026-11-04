// CR-118 · UW-FR-12 · form đơn giản của bước flow (node `form`, mức cấu hình 2 — intake câu 13). MỘT định nghĩa trường duy nhất:
// `FormFieldSchema` (hub-admin/process-form — Hub kiểm theo đúng schema này, admin-web sửa theo đúng schema này); ở đây chỉ
// đặt tên theo miền flow + dựng validator GIÁ TRỊ từ form trong SNAPSHOT (server dùng; web báo lỗi sớm). 8 loại: text, textarea,
// number, money, date, select, checkbox, file_ref. Chỉ dữ liệu, không HTML/script/biểu thức; nhãn là text thuần.
import { z } from "zod";
import { FIELD_KEY_RE } from "../hub-admin/field-key";
import {
  FORM_FIELD_TYPES,
  FORM_FIELDS_MAX,
  FORM_OPTIONS_MAX,
  FORM_TEXT_MAX,
  FORM_TEXTAREA_MAX,
  type FormField,
  FormFieldSchema,
  FormFieldsSchema,
  type FormFieldType,
} from "../hub-admin/process-form";

export const FLOW_FORM_MAX_FIELDS = FORM_FIELDS_MAX;
export const FLOW_FORM_TEXT_MAX = FORM_TEXT_MAX;
export const FLOW_FORM_TEXTAREA_MAX = FORM_TEXTAREA_MAX;
export const FLOW_FORM_SELECT_MAX_OPTIONS = FORM_OPTIONS_MAX;
export const FLOW_FORM_FIELD_TYPES = FORM_FIELD_TYPES;
export type FlowFormFieldType = FormFieldType;

export const FlowFormFieldSchema = FormFieldSchema;
export type FlowFormField = FormField;

export const FlowFormSchema = z.strictObject({ fields: FormFieldsSchema });
export type FlowForm = z.infer<typeof FlowFormSchema>;

/** Giá trị một trường như web gửi: chuỗi / số / bool (checkbox) / null; file_ref = id tệp (uuid) của FileBox gói. */
export const FlowFormValueSchema = z.union([
  z.string().max(FLOW_FORM_TEXTAREA_MAX),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type FlowFormValue = z.infer<typeof FlowFormValueSchema>;
export const FlowFormValuesSchema = z
  .record(z.string().regex(FIELD_KEY_RE), FlowFormValueSchema)
  .refine((r) => Object.keys(r).length <= FLOW_FORM_MAX_FIELDS, { message: "too many fields" });
export type FlowFormValues = z.infer<typeof FlowFormValuesSchema>;

/** Ký tự điều khiển (trừ \t \n \r) bị chặn ở chuỗi người dùng nhập (NUL ⇒ Postgres 22021). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: chặn đúng các ký tự điều khiển
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const noControl = (s: z.ZodString) =>
  s.refine((v) => !CONTROL.test(v), { message: "control characters" });

function valueSchema(f: FlowFormField): z.ZodType {
  switch (f.type) {
    case "text":
    case "textarea":
      return noControl(z.string().trim().max(f.max_len));
    case "number": {
      let n = z.number().finite();
      if (f.integer) n = n.int();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      return n;
    }
    case "money": {
      let n = z.number().int();
      n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      return n;
    }
    case "date":
      return IsoDate;
    case "select":
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
    case "checkbox":
      return f.required ? z.literal(true) : z.boolean();
    case "file_ref":
      return z.uuid();
  }
}

/** Validator giá trị dựng từ form (của SNAPSHOT run — server; web dùng để báo lỗi sớm). Strict: trường lạ ⇒ lỗi. */
export function flowFormValuesSchema(form: FlowForm) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of form.fields) {
    const v = valueSchema(f);
    shape[f.key] = f.required ? v : v.nullable().optional();
  }
  return z.strictObject(shape);
}
