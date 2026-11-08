// CR-125 · cr125-manual-start-engine · cấu hình node «Bắt đầu bằng phiếu yêu cầu» (`core.start-form`): MỘT nguồn cho trình sửa (panel),
// Hub (kiểm phiếu bằng zod, ai được bắt đầu) và sổ module. Chỉ dữ liệu + zod (luật `contracts-only-zod`), không I/O.
import { z } from "zod";
import type { AppFactType, AppNodeIo } from "../../../app-manifest/manifest";
import { UuidSchema } from "../../../common";
import { FIELD_KEY_RE } from "../../../hub-admin/field-key";
import type { PortWidget } from "../../types";

export const START_FORM_NODE_KEY = "core.start-form";
/** Sự kiện ghi vào `hub.flow_events` cho mỗi lần bắt đầu bằng phiếu (đã chốt ngay, bộ điều phối không nhận). */
export const START_FORM_EVENT = "core.start-form";

/** Loại ô của phiếu = bộ `PortWidget` dùng chung + `attachments` (tệp đính kèm, mảng id tệp — panel UI thêm ô này). */
export const START_FORM_FIELD_TYPES = [
  "text",
  "longtext",
  "money",
  "date",
  "people",
  "department",
  "attachments",
] as const satisfies readonly (PortWidget | "attachments")[];
export type StartFormFieldType = (typeof START_FORM_FIELD_TYPES)[number];

export const START_FORM_FIELDS_MAX = 20;
export const START_FORM_TEXT_MAX = 500;
export const START_FORM_LONGTEXT_MAX = 5000;
export const START_FORM_LIST_MAX = 20;
const GROUP_KEY_RE = /^[a-z][a-z0-9-]{1,63}$/;

export const StartFormFieldSchema = z.strictObject({
  key: z.string().regex(FIELD_KEY_RE),
  label: z.string().trim().min(1).max(100),
  type: z.enum(START_FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  help: z.string().max(200).optional(),
});
export type StartFormField = z.infer<typeof StartFormFieldSchema>;

/** Ai được bắt đầu: mọi người trong công ty, hoặc thành viên các nhóm (id ở bản công ty; mã ở mẫu Thư viện). */
export const StartFormStartersSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("everyone") }),
  z.strictObject({
    kind: z.literal("groups"),
    group_ids: z.array(UuidSchema).max(20).default([]),
    group_keys: z.array(z.string().regex(GROUP_KEY_RE)).max(20).optional(),
  }),
]);
export type StartFormStarters = z.infer<typeof StartFormStartersSchema>;

export const StartFormConfigSchema = z
  .strictObject({
    fields: z.array(StartFormFieldSchema).min(1).max(START_FORM_FIELDS_MAX),
    starters: StartFormStartersSchema,
    /** Tên yêu cầu, `{{khoá}}` = giá trị ô (vd "Đề xuất mua {{item}}"). */
    title_template: z.string().trim().min(1).max(200),
  })
  .refine((c) => new Set(c.fields.map((f) => f.key)).size === c.fields.length, {
    message: "duplicate field key",
    path: ["fields"],
  });
export type StartFormConfig = z.infer<typeof StartFormConfigSchema>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function valueSchema(t: StartFormFieldType, required: boolean): z.ZodTypeAny {
  const list = (item: z.ZodTypeAny) =>
    z
      .array(item)
      .min(required ? 1 : 0)
      .max(START_FORM_LIST_MAX);
  switch (t) {
    case "text":
    case "longtext": {
      const max = t === "text" ? START_FORM_TEXT_MAX : START_FORM_LONGTEXT_MAX;
      return z
        .string()
        .trim()
        .min(required ? 1 : 0)
        .max(max);
    }
    case "money":
      return z.number().finite().nonnegative();
    case "date":
      return z.string().regex(DATE_RE);
    case "department":
      return UuidSchema;
    case "people":
    case "attachments":
      return list(UuidSchema);
  }
}

/** zod của giá trị phiếu theo cấu hình node: ô bắt buộc phải có; ô lạ bị từ chối. */
export function startFormValuesSchema(cfg: Pick<StartFormConfig, "fields">) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of cfg.fields) {
    const s = valueSchema(f.type, f.required);
    shape[f.key] = f.required ? s : s.optional().nullable();
  }
  return z.strictObject(shape);
}
export type StartFormValues = Record<string, unknown>;

/** Kiểu đầu ra (cổng) của ô phiếu — để `autoMapInputs` của bước sau nối được. */
const OUT_TYPE: Record<StartFormFieldType, AppFactType> = {
  text: "string",
  longtext: "string",
  money: "number",
  date: "date",
  people: "string",
  department: "department",
  attachments: "string",
};

/** Đầu ra của node = các ô phiếu (nguồn `start` cho `mapSourcesAt`). */
export function startFormOutputs(cfg: Pick<StartFormConfig, "fields">): AppNodeIo[] {
  return cfg.fields.map((f) => ({
    key: f.key,
    type: OUT_TYPE[f.type],
    required: f.required,
    label: { vi: f.label, en: f.label },
  }));
}

/** Giá trị phiếu ⇒ input của lượt (`process_runs.inputs`): tiền = number; danh sách = nối ", "; còn lại = text. Rỗng ⇒ bỏ. */
export function startFormRunInputs(
  cfg: Pick<StartFormConfig, "fields">,
  values: StartFormValues,
): { key: string; type: string; text?: string; value?: string }[] {
  const out: { key: string; type: string; text?: string; value?: string }[] = [];
  for (const f of cfg.fields) {
    const v = values[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length > 0) out.push({ key: f.key, type: "text", text: v.map(String).join(", ") });
    } else if (typeof v === "number") out.push({ key: f.key, type: "number", value: String(v) });
    else out.push({ key: f.key, type: "text", text: String(v) });
  }
  return out;
}

/** Tên yêu cầu từ mẫu: `{{khoá}}` ⇒ giá trị ô (danh sách nối ", "; vắng ⇒ rỗng). Cắt 200 ký tự. */
export function renderStartTitle(tpl: string, values: StartFormValues): string {
  const s = tpl.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_m, k: string) => {
    const v = values[k];
    if (v === undefined || v === null) return "";
    return Array.isArray(v) ? v.map(String).join(", ") : String(v);
  });
  return s.trim().slice(0, 200);
}

/** Mã nhóm (mẫu Thư viện) mà «ai được bắt đầu» cần — `templateNeeds` tính là nhóm cần. */
export function startFormGroupKeys(raw: unknown): string[] {
  const p = StartFormStartersSchema.safeParse(
    (raw as { starters?: unknown } | null | undefined)?.starters,
  );
  return p.success && p.data.kind === "groups" ? [...(p.data.group_keys ?? [])] : [];
}
