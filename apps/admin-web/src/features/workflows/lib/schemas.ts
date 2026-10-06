// ADM-FR-10, ADM-FR-11, ADM-FR-14 · M2-R07, R08 · schema form workflow; hằng số từ @ai/contracts, thông điệp là KEY i18n (plan-frontend §4).
import {
  APP_TYPES,
  BASE_URL_MAX,
  CATALOG_KEY_RE,
  INPUT_DESC_MAX,
  INPUT_NAME_RE,
  INPUT_SCHEMA_MAX,
  INPUT_TYPES,
  NAME_MAX,
  OUTPUT_FIELD_MAX,
  SELECT_OPTION_MAX,
  SELECT_OPTIONS_MAX,
  WORKFLOW_DESC_MAX,
  WORKFLOW_DESC_MIN,
  type Workflow,
  type WorkflowCreateRequest,
  type WorkflowInput,
} from "@ai/contracts";
import { z } from "zod";

export type ParamValues = {
  name: string;
  type: (typeof INPUT_TYPES)[number];
  required: boolean;
  description: string;
  /** Lựa chọn của `select`, nhập phân tách bằng dấu phẩy. */
  options: string;
};
export type WorkflowFormValues = {
  key: string;
  name: string;
  app_type: (typeof APP_TYPES)[number];
  secret_id: string;
  base_url: string;
  output_field: string;
  description: string;
  enabled: boolean;
  /** X1 · HUB-FR-95: Chat hỏi Đồng ý/Huỷ trước khi chạy. */
  side_effect: boolean;
  input_schema: ParamValues[];
};

/** "a, b, a" → ["a","b"]: trim, bỏ rỗng, bỏ trùng. */
export function parseOptions(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    ),
  ];
}

function validBaseUrl(v: string): boolean {
  if (v.length > BASE_URL_MAX || !/^https?:\/\//.test(v) || !URL.canParse(v)) return false;
  const u = new URL(v);
  return u.username === "" && u.password === "";
}

const param = z.object({
  name: z.string().regex(INPUT_NAME_RE, "workflows.error.paramName"),
  type: z.enum(INPUT_TYPES),
  required: z.boolean(),
  description: z
    .string()
    .trim()
    .min(1, "workflows.error.paramDesc")
    .max(INPUT_DESC_MAX, "workflows.error.paramDesc"),
  options: z.string(),
});

function checkParams(params: ParamValues[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  params.forEach((p, i) => {
    if (seen.has(p.name)) {
      ctx.addIssue({
        code: "custom",
        path: ["input_schema", i, "name"],
        message: "workflows.error.paramDup",
      });
    }
    seen.add(p.name);
    if (p.type !== "select") return;
    const opts = parseOptions(p.options);
    const bad = opts.length > SELECT_OPTIONS_MAX || opts.some((o) => o.length > SELECT_OPTION_MAX);
    const message =
      opts.length === 0 ? "workflows.error.optionsRequired" : "workflows.error.optionsLimit";
    if (opts.length === 0 || bad) {
      ctx.addIssue({ code: "custom", path: ["input_schema", i, "options"], message });
    }
  });
}

export const workflowSchema = z
  .object({
    key: z.string().trim().toLowerCase().regex(CATALOG_KEY_RE, "workflows.error.keyFormat"),
    name: z
      .string()
      .trim()
      .min(1, "workflows.error.nameRequired")
      .max(NAME_MAX, "workflows.error.nameRequired"),
    app_type: z.enum(APP_TYPES),
    secret_id: z.string().min(1, "workflows.error.secretRequired"),
    base_url: z.string().trim().refine(validBaseUrl, "workflows.error.baseUrl"),
    output_field: z.string().trim().max(OUTPUT_FIELD_MAX, "workflows.error.outputField"),
    description: z
      .string()
      .trim()
      .min(WORKFLOW_DESC_MIN, "workflows.error.descLength")
      .max(WORKFLOW_DESC_MAX, "workflows.error.descLength"),
    enabled: z.boolean(),
    side_effect: z.boolean(),
    input_schema: z.array(param).max(INPUT_SCHEMA_MAX, "workflows.schema.max"),
  })
  .superRefine((v, ctx) => checkParams(v.input_schema, ctx));

export const emptyWorkflowForm = (): WorkflowFormValues => ({
  key: "",
  name: "",
  app_type: "workflow",
  secret_id: "",
  base_url: "",
  output_field: "",
  description: "",
  enabled: true,
  side_effect: false,
  input_schema: [],
});

export function toFormValues(w: Workflow): WorkflowFormValues {
  return {
    key: w.key,
    name: w.name,
    app_type: w.app_type,
    secret_id: w.secret.id,
    base_url: w.base_url,
    output_field: w.output_field ?? "",
    description: w.description,
    enabled: w.enabled,
    // Response cũ chưa có trường ⇒ coi `false` (plan-frontend §2.1).
    side_effect: w.side_effect ?? false,
    input_schema: w.input_schema.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required,
      description: p.description,
      options: (p.options ?? []).join(", "),
    })),
  };
}

/** Mô tả tham số gửi nguyên văn sau `trim` (M2-R08); `options` chỉ có khi `select`. */
export function toInputSchema(params: ParamValues[]): WorkflowInput[] {
  return params.map((p) => ({
    name: p.name,
    type: p.type,
    required: p.required,
    description: p.description.trim(),
    ...(p.type === "select" ? { options: parseOptions(p.options) } : {}),
  }));
}

/** Phần body chung của POST/PATCH (không có `key`, `version`). */
export function toRequestBody(v: WorkflowFormValues): Omit<WorkflowCreateRequest, "key"> {
  return {
    name: v.name.trim(),
    description: v.description.trim(),
    app_type: v.app_type,
    base_url: v.base_url.trim(),
    secret_id: v.secret_id,
    input_schema: toInputSchema(v.input_schema),
    output_field: v.output_field.trim() === "" ? null : v.output_field.trim(),
    enabled: v.enabled,
    side_effect: v.side_effect,
  };
}
