// CR-118 · UW-FR-12 · form đơn giản của bước flow (node `form`, mức cấu hình 2 — intake câu 13). Tập con zod CỐ ĐỊNH: chỉ
// dữ liệu, không HTML/script/biểu thức; nhãn là text thuần (renderer không dùng innerHTML). Server dựng validator từ form
// trong SNAPSHOT của run (`flowFormValuesSchema`), bỏ trường lạ (strict), giới hạn độ dài — giá trị máy khách không được tin.
import { z } from "zod";

export const FLOW_FORM_MAX_FIELDS = 20;
export const FLOW_FORM_TEXT_MAX = 500;
export const FLOW_FORM_TEXTAREA_MAX = 4000;
export const FLOW_FORM_SELECT_MAX_OPTIONS = 50;
export const FLOW_FORM_FILES_MAX = 10;

/** Ký tự điều khiển (trừ \t \n \r) bị chặn ở mọi chuỗi của form (NUL ⇒ Postgres 22021). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: chặn đúng các ký tự điều khiển
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Nhãn: text thuần, không `<` `>` (không bao giờ là HTML), không ký tự điều khiển. */
const Label = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !CONTROL.test(v) && !/[<>]/.test(v), { message: "plain text only" });
const FieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Base = {
  key: FieldKey,
  label: Label(120),
  help: Label(300).optional(),
  required: z.boolean().default(false),
};

export const FLOW_FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
  "file_ref",
] as const;
export type FlowFormFieldType = (typeof FLOW_FORM_FIELD_TYPES)[number];
/** Nhóm tệp được chọn (không MIME tự do). */
export const FLOW_FORM_FILE_ACCEPT = ["pdf", "image", "office", "any"] as const;

const TextField = z.strictObject({
  ...Base,
  type: z.literal("text"),
  max_len: z.number().int().min(1).max(FLOW_FORM_TEXT_MAX).default(200),
});
const TextareaField = z.strictObject({
  ...Base,
  type: z.literal("textarea"),
  max_len: z.number().int().min(1).max(FLOW_FORM_TEXTAREA_MAX).default(2000),
});
const NumberField = z
  .strictObject({
    ...Base,
    type: z.literal("number"),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().default(false),
  })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, {
    message: "min > max",
  });
const DateField = z
  .strictObject({
    ...Base,
    type: z.literal("date"),
    min: IsoDate.optional(),
    max: IsoDate.optional(),
  })
  .refine((f) => !f.min || !f.max || f.min <= f.max, { message: "min > max" });
const SelectOption = z.strictObject({
  value: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  label: Label(120),
});
const SelectField = z
  .strictObject({
    ...Base,
    type: z.literal("select"),
    options: z.array(SelectOption).min(1).max(FLOW_FORM_SELECT_MAX_OPTIONS),
    multiple: z.boolean().default(false),
  })
  .refine((f) => new Set(f.options.map((o) => o.value)).size === f.options.length, {
    message: "duplicate option value",
  });
const CheckboxField = z.strictObject({ ...Base, type: z.literal("checkbox") });
const FileRefField = z.strictObject({
  ...Base,
  type: z.literal("file_ref"),
  max_files: z.number().int().min(1).max(FLOW_FORM_FILES_MAX).default(1),
  accept: z.enum(FLOW_FORM_FILE_ACCEPT).default("any"),
});

export const FlowFormFieldSchema = z.discriminatedUnion("type", [
  TextField,
  TextareaField,
  NumberField,
  DateField,
  SelectField,
  CheckboxField,
  FileRefField,
]);
export type FlowFormField = z.infer<typeof FlowFormFieldSchema>;

export const FlowFormSchema = z
  .strictObject({ fields: z.array(FlowFormFieldSchema).min(1).max(FLOW_FORM_MAX_FIELDS) })
  .refine((f) => new Set(f.fields.map((x) => x.key)).size === f.fields.length, {
    message: "duplicate field key",
  });
export type FlowForm = z.infer<typeof FlowFormSchema>;

/** Giá trị một trường: chuỗi / số / bool / danh sách (select nhiều, file_ref = id tệp của FileBox gói). */
export const FlowFormValueSchema = z.union([
  z.string().max(FLOW_FORM_TEXTAREA_MAX),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(128)).max(FLOW_FORM_SELECT_MAX_OPTIONS),
  z.null(),
]);
export type FlowFormValue = z.infer<typeof FlowFormValueSchema>;
export const FlowFormValuesSchema = z
  .record(FieldKey, FlowFormValueSchema)
  .refine((r) => Object.keys(r).length <= FLOW_FORM_MAX_FIELDS, { message: "too many fields" });
export type FlowFormValues = z.infer<typeof FlowFormValuesSchema>;

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
    case "date":
      return IsoDate.refine((v) => (!f.min || v >= f.min) && (!f.max || v <= f.max), {
        message: "out of range",
      });
    case "select": {
      const one = z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
      return f.multiple ? z.array(one).max(f.options.length) : one;
    }
    case "checkbox":
      return z.boolean();
    case "file_ref":
      return z.array(z.uuid()).min(1).max(f.max_files);
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
