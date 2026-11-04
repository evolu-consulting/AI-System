// CR-118 · cr118-flow-admin: trường của node `form` ở editor — draft (chuỗi nhập tay) ↔ `FormField` của contract (MỘT schema chung
// với flow/Hub), đồng bộ `output.fields` (Hub ép khớp key + kiểu, lệch ⇒ FORM_INVALID), validate bằng câu tiếng Việt. Thuần.
import {
  FIELD_KEY_RE,
  FORM_FIELD_TYPES,
  FORM_FIELDS_MAX,
  FORM_MONEY_MAX,
  FORM_NUMBER_ABS_MAX,
  FORM_OPTION_VALUE_RE,
  FORM_OPTIONS_MAX,
  FORM_OUTPUT_TYPE,
  FORM_TEXT_MAX,
  FORM_TEXTAREA_MAX,
  type FormField,
  FormFieldsSchema,
  type FormFieldType,
  FormHelpSchema,
  FormLabelSchema,
  OUTPUT_FILENAME_RE,
} from "@ai/contracts/hub-admin";
import { emptyAutofix } from "./autofix-form";
import type {
  DraftErrors,
  FieldDraft,
  FormFieldDraft,
  FormOptionDraft,
  StageDraft,
} from "./draft-types";

export type { FormFieldType };
export { FORM_FIELD_TYPES, FORM_FIELDS_MAX, FORM_OPTIONS_MAX };

/** Giá trị `StageDraft.executor` của kiểu "Người điền form". */
export const FORM_EXECUTOR = "form";
export const FORM_RESULT_SECTION = "Kết quả";
export const isForm = (s: Pick<StageDraft, "executor">): boolean => s.executor === FORM_EXECUTOR;
/** Chọn loại: stage form phải chờ người (`after = review`), không hành động thật; trường bắt đầu rỗng. */
export const FORM_PATCH: Partial<StageDraft> = {
  executor: FORM_EXECUTOR,
  after: "review",
  real: false,
  formFields: [],
  fields: [],
};

const E = "process.admin.editor.stage.form.err.";
export const FORM_ERR = {
  noFields: `${E}noFields`,
  tooMany: `${E}tooMany`,
  key: `${E}key`,
  keyDup: `${E}keyDup`,
  label: `${E}label`,
  help: `${E}help`,
  maxLenText: `${E}maxLenText`,
  maxLenTextarea: `${E}maxLenTextarea`,
  number: `${E}number`,
  money: `${E}money`,
  range: `${E}range`,
  optionsMin: `${E}optionsMin`,
  optionsMax: `${E}optionsMax`,
  optionValue: `${E}optionValue`,
  optionDup: `${E}optionDup`,
  optionLabel: `${E}optionLabel`,
  generic: `${E}generic`,
  /** Luật Hub `FORM_INVALID` (ruleErrorKey). */
  rule: `${E}FORM_INVALID`,
} as const;
/** Khoá câu lỗi của form (tính lại live mỗi lần render, như P-d2). */
export const isFormErrKey = (v: string): boolean => v.startsWith(E);

const TEXT_DEFAULT = 200;
const TEXTAREA_DEFAULT = 2000;

export const emptyOption = (): FormOptionDraft => ({ value: "", label: "" });

/** Trường rỗng của `type` (nhãn/mã do nơi gọi đặt). */
export function blankField(type: FormFieldType): FormFieldDraft {
  return {
    type,
    key: "",
    keyAuto: true,
    label: "",
    help: "",
    required: false,
    maxLen: type === "textarea" ? String(TEXTAREA_DEFAULT) : String(TEXT_DEFAULT),
    min: "",
    max: "",
    integer: false,
    options: type === "select" ? [emptyOption()] : [],
  };
}

/** Bỏ dấu + chuyển nhãn thành mã trường hợp lệ (`FIELD_KEY_RE`), không trùng `taken`. */
export function fieldKeyFromLabel(label: string, taken: readonly string[]): string {
  let base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = `truong_${base}`.replace(/_$/, "");
  base = base.slice(0, 28).replace(/_+$/, "") || "truong";
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

/** Thêm một trường mới (nhãn "Trường n", mã sinh theo nhãn). */
export function addField(list: readonly FormFieldDraft[], type: FormFieldType): FormFieldDraft[] {
  const label = `Trường ${list.length + 1}`;
  const key = fieldKeyFromLabel(
    label,
    list.map((f) => f.key),
  );
  return [...list, { ...blankField(type), label, key }];
}

/** Đổi nhãn; còn `keyAuto` ⇒ mã sinh lại theo nhãn. */
export function relabel(
  list: readonly FormFieldDraft[],
  j: number,
  label: string,
): FormFieldDraft[] {
  return list.map((f, i) => {
    if (i !== j) return f;
    if (!f.keyAuto) return { ...f, label };
    const others = list.filter((_, k) => k !== j).map((x) => x.key);
    return { ...f, label, key: fieldKeyFromLabel(label, others) };
  });
}

/** Đổi loại: giữ mã/nhãn/gợi ý/bắt buộc, đặt lại giới hạn riêng của loại. */
export function retype(f: FormFieldDraft, type: FormFieldType): FormFieldDraft {
  if (f.type === type) return f;
  const b = blankField(type);
  return {
    ...b,
    key: f.key,
    keyAuto: f.keyAuto,
    label: f.label,
    help: f.help,
    required: f.required,
  };
}

export function moveField(
  list: readonly FormFieldDraft[],
  j: number,
  dir: -1 | 1,
): FormFieldDraft[] {
  const to = j + dir;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const a = out[j] as FormFieldDraft;
  out[j] = out[to] as FormFieldDraft;
  out[to] = a;
  return out;
}

// ── draft ↔ contract ──────────────────────────────────────────────────────────────

const optNum = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
};
const maxLenOf = (s: string, def: number, cap: number): number => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= cap ? n : def;
};

export function fieldToDraft(f: FormField): FormFieldDraft {
  const b = blankField(f.type);
  const common = {
    ...b,
    key: f.key,
    keyAuto: false,
    label: f.label,
    help: f.help ?? "",
    required: f.required,
  };
  switch (f.type) {
    case "text":
    case "textarea":
      return { ...common, maxLen: String(f.max_len) };
    case "number":
      return {
        ...common,
        min: f.min === undefined ? "" : String(f.min),
        max: f.max === undefined ? "" : String(f.max),
        integer: f.integer,
      };
    case "money":
      return {
        ...common,
        min: f.min === 0 ? "" : String(f.min),
        max: f.max === undefined ? "" : String(f.max),
      };
    case "select":
      return { ...common, options: f.options.map((o) => ({ ...o })) };
    default:
      return common;
  }
}

/** Draft → `FormField` (giá trị hỏng rơi về mặc định/bỏ — lỗi đã được `formFieldErrors` báo trước khi Lưu). */
export function draftToField(d: FormFieldDraft): FormField {
  const base = {
    key: d.key,
    label: d.label.trim(),
    required: d.required,
    ...(d.help.trim() === "" ? {} : { help: d.help.trim() }),
  };
  const min = optNum(d.min);
  const max = optNum(d.max);
  switch (d.type) {
    case "text":
      return { ...base, type: "text", max_len: maxLenOf(d.maxLen, TEXT_DEFAULT, FORM_TEXT_MAX) };
    case "textarea":
      return {
        ...base,
        type: "textarea",
        max_len: maxLenOf(d.maxLen, TEXTAREA_DEFAULT, FORM_TEXTAREA_MAX),
      };
    case "number":
      return {
        ...base,
        type: "number",
        integer: d.integer,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
      };
    case "money":
      return {
        ...base,
        type: "money",
        min: min ?? 0,
        ...(max === undefined ? {} : { max }),
      };
    case "select":
      return {
        ...base,
        type: "select",
        options: d.options.map((o) => ({ value: o.value, label: o.label.trim() })),
      };
    case "checkbox":
      return { ...base, type: "checkbox" };
    case "date":
      return { ...base, type: "date" };
    case "file_ref":
      return { ...base, type: "file_ref" };
  }
}

export const draftsToFields = (list: readonly FormFieldDraft[]): FormField[] =>
  list.map(draftToField);

/** `output.fields` của stage form: đúng như Hub (`formOutputFields`) — key + kiểu theo `FORM_OUTPUT_TYPE`, không bắt buộc. */
export const formOutputFields = (list: readonly FormFieldDraft[]): FieldDraft[] =>
  list.map((f) => ({ key: f.key, type: FORM_OUTPUT_TYPE[f.type], required: false }));

/** Sửa trường form ⇒ patch có cả `fields` (output) để If/rẽ nhánh/bước sau thấy ngay. */
export const formPatch = (list: FormFieldDraft[]): Partial<StageDraft> => ({
  formFields: list,
  fields: formOutputFields(list),
});

/** Bản dùng để gửi/validate: Hub ép template/mục/fields/answerer/nguồn; giữ `instruction`, `timeout`, `after`. */
export function normalizeForm(s: StageDraft): StageDraft {
  if (!isForm(s)) return s;
  const file = `${s.key.replace(/_/g, "-")}.md`;
  return {
    ...s,
    filename: OUTPUT_FILENAME_RE.test(s.filename)
      ? s.filename
      : OUTPUT_FILENAME_RE.test(file)
        ? file
        : "form.md",
    template: `# ${s.name.trim()}\n\n## ${FORM_RESULT_SECTION}\n`,
    sections: [FORM_RESULT_SECTION],
    fields: formOutputFields(s.formFields ?? []),
    after: "review",
    real: false,
    answerer: "starter",
    answererId: "",
    budget: "",
    sources: [],
    mustKnow: "",
    autofix: emptyAutofix(),
  };
}

// ── validate (câu lỗi tiếng Việt ở i18n `process.admin.editor.stage.form.err.*`) ──────────────

const intIn = (s: string, lo: number, hi: number): boolean => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= lo && n <= hi;
};
const blank = (s: string): boolean => s.trim() === "";

type At = (p: string) => string;

function textErrors(f: FormFieldDraft, at: At, e: DraftErrors): void {
  const text = f.type === "text";
  if (!intIn(f.maxLen, 1, text ? FORM_TEXT_MAX : FORM_TEXTAREA_MAX))
    e[at("max_len")] = text ? FORM_ERR.maxLenText : FORM_ERR.maxLenTextarea;
}

/** number: số hữu hạn trong ±1e15; money: số nguyên 0…FORM_MONEY_MAX; rỗng = không giới hạn. */
function boundErrors(f: FormFieldDraft, at: At, e: DraftErrors): void {
  const money = f.type === "money";
  const lo = money ? 0 : -FORM_NUMBER_ABS_MAX;
  const hi = money ? FORM_MONEY_MAX : FORM_NUMBER_ABS_MAX;
  const ok = (s: string): boolean => {
    const n = Number(s);
    return (
      blank(s) || (Number.isFinite(n) && n >= lo && n <= hi && (!money || Number.isInteger(n)))
    );
  };
  const bad = money ? FORM_ERR.money : FORM_ERR.number;
  if (!ok(f.min)) e[at("min")] = bad;
  if (!ok(f.max)) e[at("max")] = bad;
  const both = ok(f.min) && ok(f.max) && !blank(f.min) && !blank(f.max);
  if (both && Number(f.min) > Number(f.max)) e[at("max")] = FORM_ERR.range;
}

function limitErrors(f: FormFieldDraft, at: At, e: DraftErrors): void {
  if (f.type === "text" || f.type === "textarea") textErrors(f, at, e);
  else if (f.type === "number" || f.type === "money") boundErrors(f, at, e);
  else if (f.type === "select") optionErrors(f, at, e);
}

function optionErrors(f: FormFieldDraft, at: (p: string) => string, e: DraftErrors): void {
  if (f.options.length < 1) e[at("options")] = FORM_ERR.optionsMin;
  else if (f.options.length > FORM_OPTIONS_MAX) e[at("options")] = FORM_ERR.optionsMax;
  f.options.forEach((o, k) => {
    if (!FORM_OPTION_VALUE_RE.test(o.value)) e[at(`options.${k}.value`)] = FORM_ERR.optionValue;
    else if (f.options.some((x, m) => m < k && x.value === o.value))
      e[at(`options.${k}.value`)] = FORM_ERR.optionDup;
    if (!FormLabelSchema.safeParse(o.label).success)
      e[at(`options.${k}.label`)] = FORM_ERR.optionLabel;
  });
}

/** Lỗi trường form của stage `i` (path `stages.i.executor.fields[.j.<ô>]`). */
function stageFormErrors(s: StageDraft, i: number, e: DraftErrors): void {
  const list = s.formFields ?? [];
  const root = `stages.${i}.executor.fields`;
  if (list.length < 1) e[root] = FORM_ERR.noFields;
  else if (list.length > FORM_FIELDS_MAX) e[root] = FORM_ERR.tooMany;
  list.forEach((f, j) => {
    const at = (p: string) => `${root}.${j}.${p}`;
    if (!FIELD_KEY_RE.test(f.key)) e[at("key")] = FORM_ERR.key;
    else if (list.some((x, m) => m < j && x.key === f.key)) e[at("key")] = FORM_ERR.keyDup;
    if (!FormLabelSchema.safeParse(f.label).success) e[at("label")] = FORM_ERR.label;
    if (!blank(f.help) && !FormHelpSchema.safeParse(f.help).success) e[at("help")] = FORM_ERR.help;
    limitErrors(f, at, e);
  });
  // lưới an toàn: còn điều contract từ chối mà chưa có câu riêng ⇒ một câu chung ở đầu danh sách
  const had = Object.keys(e).some((k) => k.startsWith(root));
  if (!had && list.length > 0 && !FormFieldsSchema.safeParse(draftsToFields(list)).success)
    e[root] = FORM_ERR.generic;
}

/** Lỗi trường form của MỌI stage form (live — không đợi Lưu). */
export function formFieldErrors(stages: readonly StageDraft[]): DraftErrors {
  const e: DraftErrors = {};
  stages.forEach((s, i) => {
    if (isForm(s)) stageFormErrors(s, i, e);
  });
  return e;
}
