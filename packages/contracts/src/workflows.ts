// ADM-FR-10, ADM-FR-11, ADM-FR-13, ADM-FR-14, ADM-FR-15, AC-A05, AC-A13 · contract /admin/workflows*
// (spec M2 §3, M2-R07…R12, R18). Mô tả workflow + mô tả tham số là tool description cho Hub: lưu nguyên văn sau trim.
import { z } from "zod";
import {
  AgentRefSchema,
  AppTypeSchema,
  BASE_URL_MAX,
  CATALOG_KEY_RE,
  CatalogKeySchema,
  CountSchema,
  INPUT_DESC_MAX,
  INPUT_NAME_RE,
  INPUT_SCHEMA_MAX,
  InputTypeSchema,
  IsoDateTime,
  ListQueryBase,
  listResponseSchema,
  NAME_MAX,
  OnOffSchema,
  OUTPUT_FIELD_MAX,
  QueryBoolSchema,
  SECRET_NAME_RE,
  SELECT_OPTION_MAX,
  SELECT_OPTIONS_MAX,
  SecretNameSchema,
  UpdatedBySchema,
  USAGES_MAX,
  UsageCommandSchema,
  UuidSchema,
  uniqueArray,
  VersionSchema,
  WORKFLOW_DESC_MAX,
  WORKFLOW_DESC_MIN,
} from "./common";

/** `options` bắt buộc khi `type=select`, cấm khi khác (superRefine → issue tại `options`). */
export const WorkflowInputSchema = z
  .strictObject({
    name: z.string().regex(INPUT_NAME_RE),
    type: InputTypeSchema,
    required: z.boolean(),
    description: z.string().trim().min(1).max(INPUT_DESC_MAX),
    options: uniqueArray(z.string().trim().min(1).max(SELECT_OPTION_MAX), SELECT_OPTIONS_MAX)
      .min(1)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "select" && v.options === undefined)
      ctx.addIssue({ code: "custom", message: "options required for select", path: ["options"] });
    if (v.type !== "select" && v.options !== undefined)
      ctx.addIssue({ code: "custom", message: "options only for select", path: ["options"] });
  });
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

/** 0–50 tham số, `name` không trùng (issue tại `[i, "name"]`). */
export const InputSchemaSchema = z
  .array(WorkflowInputSchema)
  .max(INPUT_SCHEMA_MAX)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((p, i) => {
      if (seen.has(p.name))
        ctx.addIssue({ code: "custom", message: "duplicate", path: [i, "name"] });
      seen.add(p.name);
    });
  });
export type InputSchema = z.infer<typeof InputSchemaSchema>;

/** http/https, ≤ 2048, không userinfo; tiền tố `^https?://` khớp CHECK của DB (phân biệt hoa thường). */
export const BaseUrlSchema = z
  .string()
  .trim()
  .max(BASE_URL_MAX)
  .regex(/^https?:\/\//)
  .pipe(z.url({ protocol: /^https?$/ }))
  .refine(
    (v) => {
      // zod vẫn chạy refine khi z.url() đã báo lỗi: URL hỏng đã có issue riêng, không ném ở đây.
      if (!URL.canParse(v)) return true;
      const u = new URL(v);
      return u.username === "" && u.password === "";
    },
    { message: "base_url must not contain credentials" },
  );

const WorkflowNameSchema = z.string().trim().min(1).max(NAME_MAX);
const WorkflowDescSchema = z.string().trim().min(WORKFLOW_DESC_MIN).max(WORKFLOW_DESC_MAX);
const OutputFieldSchema = z.string().trim().min(1).max(OUTPUT_FIELD_MAX).nullable();

export const SecretRefSchema = z.strictObject({
  id: UuidSchema,
  name: z.string().regex(SECRET_NAME_RE),
});
export type SecretRef = z.infer<typeof SecretRefSchema>;

export const WorkflowRefSchema = z.strictObject({
  id: UuidSchema,
  key: z.string().regex(CATALOG_KEY_RE),
  name: z.string().min(1),
  enabled: z.boolean(),
});
export type WorkflowRef = z.infer<typeof WorkflowRefSchema>;

const listItemShape = {
  id: UuidSchema,
  key: z.string().regex(CATALOG_KEY_RE),
  name: z.string().min(1).max(NAME_MAX),
  app_type: AppTypeSchema,
  description: z.string().min(WORKFLOW_DESC_MIN).max(WORKFLOW_DESC_MAX),
  enabled: z.boolean(),
  secret: SecretRefSchema,
  command_count: CountSchema,
  agent_count: CountSchema,
  /** = không command **và** không agent (M2-R09), tính ở server. */
  unattached: z.boolean(),
  version: VersionSchema,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
};
const unattachedMatches = (w: {
  unattached: boolean;
  command_count: number;
  agent_count: number;
}) => w.unattached === (w.command_count === 0 && w.agent_count === 0);
const unattachedIssue = {
  message: "unattached must equal command_count = 0 && agent_count = 0",
  path: ["unattached"],
};

export const WorkflowListItemSchema = z
  .strictObject(listItemShape)
  .refine(unattachedMatches, unattachedIssue);
export type WorkflowListItem = z.infer<typeof WorkflowListItemSchema>;

export const WorkflowSchema = z
  .strictObject({
    ...listItemShape,
    base_url: z.string().max(BASE_URL_MAX),
    input_schema: InputSchemaSchema,
    output_field: z.string().min(1).max(OUTPUT_FIELD_MAX).nullable(),
    created_at: IsoDateTime,
  })
  .refine(unattachedMatches, unattachedIssue);
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowCreateRequestSchema = z.strictObject({
  key: CatalogKeySchema,
  name: WorkflowNameSchema,
  description: WorkflowDescSchema,
  app_type: AppTypeSchema,
  base_url: BaseUrlSchema,
  secret_id: UuidSchema,
  input_schema: InputSchemaSchema.default([]),
  output_field: OutputFieldSchema.default(null),
  enabled: z.boolean().default(true),
});
export type WorkflowCreateRequest = z.infer<typeof WorkflowCreateRequestSchema>;

/** `key` bất biến: không có trong schema → gửi lên là 400. Trường vắng = giữ nguyên. */
export const WorkflowUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  name: WorkflowNameSchema.optional(),
  description: WorkflowDescSchema.optional(),
  app_type: AppTypeSchema.optional(),
  base_url: BaseUrlSchema.optional(),
  secret_id: UuidSchema.optional(),
  input_schema: InputSchemaSchema.optional(),
  output_field: OutputFieldSchema.optional(),
  enabled: z.boolean().optional(),
});
export type WorkflowUpdateRequest = z.infer<typeof WorkflowUpdateRequestSchema>;

/** `q` khớp `key`/`name`/`description`; `secret` = tên secret (lạ → list rỗng); sắp `key`. */
export const WorkflowListQuerySchema = ListQueryBase.extend({
  status: OnOffSchema.optional(),
  attached: QueryBoolSchema.optional(),
  secret: SecretNameSchema.optional(),
});
export type WorkflowListQuery = z.infer<typeof WorkflowListQuerySchema>;

/** Tính trừ bộ lọc chip `status`, `attached`. */
export const WorkflowListCountsSchema = z.strictObject({
  all: CountSchema,
  on: CountSchema,
  off: CountSchema,
  unattached: CountSchema,
});
export type WorkflowListCounts = z.infer<typeof WorkflowListCountsSchema>;

export const WorkflowListResponseSchema = listResponseSchema(
  WorkflowListItemSchema,
  WorkflowListCountsSchema,
);
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>;

/** `agents_available=false` khi DB không có `hub.agent_workflows` đọc được → `agents=[]`, `agent_count=0` (M2-R12). */
export const WorkflowUsagesSchema = z
  .strictObject({
    commands: z.array(UsageCommandSchema).max(USAGES_MAX),
    agents: z.array(AgentRefSchema).max(USAGES_MAX),
    command_count: CountSchema,
    agent_count: CountSchema,
    agents_available: z.boolean(),
  })
  .refine((u) => u.agents_available || (u.agents.length === 0 && u.agent_count === 0), {
    message: "agents must be empty when agents_available = false",
    path: ["agents_available"],
  });
export type WorkflowUsages = z.infer<typeof WorkflowUsagesSchema>;
