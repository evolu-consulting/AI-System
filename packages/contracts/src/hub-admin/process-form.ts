// CR-118 · cr118-form-node · node `form` (họ `work`): một người (thành viên Group của bước, như cổng kiểm) điền form có
// trường từ TẬP CON CỐ ĐỊNH; Hub kiểm giá trị theo form trong SNAPSHOT run (bỏ trường lạ), ghi vào output stage + đóng task
// trong CÙNG transaction. Không HTML/script/biểu thức: nhãn là văn bản thuần (không `<`/`>`/ký tự điều khiển).
// `FormField` định nghĩa Ở ĐÂY (node definition); lát cr118-flow-contract (FlowFormSchema dưới `flow/`) có thể dùng lại —
// điều phối gộp khi merge. Không import `./processes` (file đó import file này) ⇒ không vòng import.
import { z } from "zod";
import { FIELD_KEY_RE } from "./process-tools";

export const FORM_FIELDS_MAX = 20;
export const FORM_LABEL_MAX = 120;
export const FORM_TEXT_MAX = 500;
export const FORM_TEXTAREA_MAX = 4_000;
export const FORM_OPTIONS_MAX = 30;
/** Trần tiền (đồng, số nguyên ≥ 0) — dưới `Number.MAX_SAFE_INTEGER`. */
export const FORM_MONEY_MAX = 1_000_000_000_000_000;
export const FORM_NUMBER_ABS_MAX = 1e15;

export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "select",
  "checkbox",
  "file_ref",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Nhãn văn bản thuần: không thẻ (`<`/`>`), không ký tự điều khiển (C0 + DEL). */
const plainLabel = (s: string): boolean =>
  ![...s].some((ch) => ch === "<" || ch === ">" || ch.charCodeAt(0) < 0x20 || ch === "\x7f");
export const FormLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(FORM_LABEL_MAX)
  .refine(plainLabel, "plain text only");
export const FORM_OPTION_VALUE_RE = /^[a-z0-9_-]{1,40}$/;

const base = {
  key: z.string().regex(FIELD_KEY_RE),
  label: FormLabelSchema,
  required: z.boolean().default(false),
};
const bound = z.number().finite().min(-FORM_NUMBER_ABS_MAX).max(FORM_NUMBER_ABS_MAX);

export const FormFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("text"),
    max_len: z.number().int().min(1).max(FORM_TEXT_MAX).default(200),
  }),
  z.strictObject({
    ...base,
    type: z.literal("textarea"),
    max_len: z.number().int().min(1).max(FORM_TEXTAREA_MAX).default(2_000),
  }),
  z.strictObject({
    ...base,
    type: z.literal("number"),
    min: bound.optional(),
    max: bound.optional(),
    integer: z.boolean().default(false),
  }),
  z.strictObject({
    ...base,
    type: z.literal("money"),
    min: z.number().int().min(0).max(FORM_MONEY_MAX).default(0),
    max: z.number().int().min(0).max(FORM_MONEY_MAX).optional(),
  }),
  z.strictObject({ ...base, type: z.literal("date") }),
  z.strictObject({
    ...base,
    type: z.literal("select"),
    options: z
      .array(
        z.strictObject({ value: z.string().regex(FORM_OPTION_VALUE_RE), label: FormLabelSchema }),
      )
      .min(1)
      .max(FORM_OPTIONS_MAX),
  }),
  z.strictObject({ ...base, type: z.literal("checkbox") }),
  /** Id tệp đính kèm (uuid) — Hub chỉ kiểm dạng; quyền đọc tệp theo kênh đính kèm như cũ. */
  z.strictObject({ ...base, type: z.literal("file_ref") }),
]);
export type FormField = z.infer<typeof FormFieldSchema>;

/** Luật hình dạng không diễn tả được bằng từng trường: key/option trùng, `min > max`. */
function fieldsIssues(fields: readonly FormField[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (seen.has(f.key)) out.push(`${i}.key`);
    seen.add(f.key);
    if ((f.type === "number" || f.type === "money") && f.min !== undefined && f.max !== undefined)
      if (f.min > f.max) out.push(`${i}.max`);
    if (f.type === "select" && new Set(f.options.map((o) => o.value)).size !== f.options.length)
      out.push(`${i}.options`);
  });
  return out;
}

export const FormExecutorSchema = z
  .strictObject({
    kind: z.literal("form"),
    fields: z.array(FormFieldSchema).min(1).max(FORM_FIELDS_MAX),
  })
  .superRefine((ex, ctx) => {
    for (const p of fieldsIssues(ex.fields))
      ctx.addIssue({ code: "custom", path: ["fields", ...p.split(".")], message: "FORM_INVALID" });
  });
export type FormExecutor = z.infer<typeof FormExecutorSchema>;

/** Kiểu field output (`output.fields[].type`) của từng loại trường — để If/bước sau đọc. */
export const FORM_OUTPUT_TYPE: Readonly<Record<FormFieldType, "string" | "number" | "date">> = {
  text: "string",
  textarea: "string",
  number: "number",
  money: "number",
  date: "date",
  select: "string",
  checkbox: "string", // "true" | "false"
  file_ref: "string",
};

/** `POST /review-tasks/:id/form` — giá trị thô; Hub kiểm theo form trong snapshot (trường lạ bị bỏ). */
export const FORM_VALUES_KEYS_MAX = 50;
export const FormSubmitRequestSchema = z.strictObject({
  values: z
    .record(z.string().max(64), z.unknown())
    .refine((v) => Object.keys(v).length <= FORM_VALUES_KEYS_MAX, "too many keys"),
});
export type FormSubmitRequest = z.infer<typeof FormSubmitRequestSchema>;

/** Lỗi riêng của node form (khối mới; không đụng khối P-a/N2 đã khoá test). `details.paths` = key trường sai. */
export const PROCESS_FORM_ERRORS = { FORM_VALUES_INVALID: 422 } as const;
export type ProcessFormErrorCode = keyof typeof PROCESS_FORM_ERRORS;
