// ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24, ADM-BR-01, ADM-BR-02, ADM-BR-06, ADM-BR-10, AC-A03 ·
// contract /admin/commands* (spec M2 §3, M2-R13…R19, R23). Cú pháp `$args.x`, `$page.url`… chỉ là hiển thị FE.
import { z } from "zod";
import {
  ALIASES_MAX,
  ARG_DEFAULT_MAX,
  ARG_NAME_RE,
  ARGS_MAX,
  ArgFallbackSchema,
  CATALOG_KEY_RE,
  CatalogKeySchema,
  COMMAND_DESC_MAX,
  COMMAND_FEATURES_MAX,
  CONST_VALUE_MAX,
  CommandModeSchema,
  CountSchema,
  FEATURE_NAME_MAX,
  INPUT_NAME_RE,
  INPUT_SCHEMA_MAX,
  InputTypeSchema,
  IsoDateTime,
  ListQueryBase,
  LocalizedTextSchema,
  listResponseSchema,
  MapSourceSchema,
  OnOffSchema,
  OUTPUT_FIELD_MAX,
  OutputRenderSchema,
  TenantKeySchema,
  TIMEOUT_MAX_S,
  TIMEOUT_MIN_S,
  UpdatedBySchema,
  UuidSchema,
  uniqueArray,
  VersionSchema,
} from "./common";
import { FeatureRefSchema } from "./features";
import { groupRefShape, refineBeta } from "./groups";
import { WorkflowRefSchema } from "./workflows";

/** Tên chính và từng alias: trim → lower → `CATALOG_KEY_RE` (một không gian tên chung, M2-R13). */
export const CommandNameSchema = CatalogKeySchema;
export const CommandDescSchema = LocalizedTextSchema(COMMAND_DESC_MAX);

/** `default` rỗng sau trim → `null`. */
export const CommandArgSchema = z.strictObject({
  name: z.string().regex(ARG_NAME_RE),
  description: CommandDescSchema,
  default: z
    .string()
    .trim()
    .max(ARG_DEFAULT_MAX)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  fallback: ArgFallbackSchema.nullable().default(null),
  rest: z.boolean().default(false),
});
export type CommandArg = z.infer<typeof CommandArgSchema>;

/** 0–20 tham số; `name` không trùng; ≤ 1 `rest=true` và phải là phần tử cuối. */
export const ArgsSchema = z
  .array(CommandArgSchema)
  .max(ARGS_MAX)
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((a, i) => {
      if (seen.has(a.name))
        ctx.addIssue({ code: "custom", message: "duplicate", path: [i, "name"] });
      seen.add(a.name);
      if (a.rest && i !== arr.length - 1)
        ctx.addIssue({ code: "custom", message: "rest must be last", path: [i, "rest"] });
    });
  });
export type Args = z.infer<typeof ArgsSchema>;

export const InputMapEntrySchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("arg"), value: z.string().regex(ARG_NAME_RE) }),
  z.strictObject({ source: z.literal("const"), value: z.string().max(CONST_VALUE_MAX) }),
  z.strictObject({
    source: z.enum(["selection", "page_url", "page_text", "attachment", "user_id", "tenant_id"]),
  }),
]);
export type InputMapEntry = z.infer<typeof InputMapEntrySchema>;

/** `{<biến workflow>: entry}` ≤ 50 khoá. */
export const InputMapSchema = z
  .record(z.string().regex(INPUT_NAME_RE), InputMapEntrySchema)
  .refine((m) => Object.keys(m).length <= INPUT_SCHEMA_MAX, { message: "too many keys" });
export type InputMap = z.infer<typeof InputMapSchema>;

/** `field` bắt buộc (FE điền sẵn từ `workflow.output_field`). */
export const CommandOutputSchema = z.strictObject({
  field: z.string().trim().min(1).max(OUTPUT_FIELD_MAX),
  render: OutputRenderSchema,
});
export type CommandOutput = z.infer<typeof CommandOutputSchema>;

/** Tính lại mỗi lần đọc/ghi từ `input_schema` hiện tại của workflow, không lưu (M2-R17). */
export const InputMapWarningSchema = z.strictObject({
  var: z.string().regex(INPUT_NAME_RE),
  type: InputTypeSchema,
  source: MapSourceSchema,
  reason: z.enum(["type_mismatch", "const_invalid"]),
});
export type InputMapWarning = z.infer<typeof InputMapWarningSchema>;

const NameRef = z.string().regex(CATALOG_KEY_RE);
export const TimeoutSchema = z.number().int().min(TIMEOUT_MIN_S).max(TIMEOUT_MAX_S);
export const AliasesSchema = uniqueArray(CommandNameSchema, ALIASES_MAX);
const FeatureIdsSchema = uniqueArray(UuidSchema, COMMAND_FEATURES_MAX);

const listItemShape = {
  id: UuidSchema,
  name: NameRef,
  aliases: z.array(NameRef).max(ALIASES_MAX),
  description: CommandDescSchema,
  workflow: WorkflowRefSchema,
  /** Sắp `key`, `core` đầu. */
  features: z.array(FeatureRefSchema),
  mode: CommandModeSchema,
  enabled: z.boolean(),
  version: VersionSchema,
  updated_at: IsoDateTime,
  updated_by: UpdatedBySchema,
};

export const CommandListItemSchema = z.strictObject(listItemShape);
export type CommandListItem = z.infer<typeof CommandListItemSchema>;

export const CommandSchema = z.strictObject({
  ...listItemShape,
  args: ArgsSchema,
  input_map: InputMapSchema,
  output: CommandOutputSchema,
  timeout_s: TimeoutSchema,
  feature_ids: z.array(UuidSchema),
  warnings: z.array(InputMapWarningSchema),
  created_at: IsoDateTime,
});
export type Command = z.infer<typeof CommandSchema>;

/** Alias không trùng tên chính (khi cả hai có trong body; PATCH chỉ gửi một bên → service kiểm trên trạng thái ghép). */
const aliasesNotName = (v: { name?: string; aliases?: string[] }) =>
  v.name === undefined || v.aliases === undefined || !v.aliases.includes(v.name);
const aliasesIssue = { message: "alias must differ from name", path: ["aliases"] };

/**
 * `timeout_s` vắng → theo `mode` (sync 30, async 120). `feature_ids` vắng → `[id của core]`;
 * `[]` hợp lệ: command "chưa gắn feature", không ai dùng được (CR-055 bỏ BR-10).
 */
export const CommandCreateRequestSchema = z
  .strictObject({
    name: CommandNameSchema,
    aliases: AliasesSchema.default([]),
    description: CommandDescSchema,
    workflow_id: UuidSchema,
    args: ArgsSchema.default([]),
    input_map: InputMapSchema.default({}),
    output: CommandOutputSchema,
    mode: CommandModeSchema.default("sync"),
    timeout_s: TimeoutSchema.optional(),
    enabled: z.boolean().default(true),
    feature_ids: FeatureIdsSchema.optional(),
  })
  .refine(aliasesNotName, aliasesIssue);
export type CommandCreateRequest = z.infer<typeof CommandCreateRequestSchema>;

/** Trường vắng = giữ nguyên; đổi `mode` không tự đổi `timeout_s`. */
export const CommandUpdateRequestSchema = z
  .strictObject({
    version: VersionSchema,
    name: CommandNameSchema.optional(),
    aliases: AliasesSchema.optional(),
    description: CommandDescSchema.optional(),
    workflow_id: UuidSchema.optional(),
    args: ArgsSchema.optional(),
    input_map: InputMapSchema.optional(),
    output: CommandOutputSchema.optional(),
    mode: CommandModeSchema.optional(),
    timeout_s: TimeoutSchema.optional(),
    enabled: z.boolean().optional(),
    feature_ids: FeatureIdsSchema.optional(),
  })
  .refine(aliasesNotName, aliasesIssue);
export type CommandUpdateRequest = z.infer<typeof CommandUpdateRequestSchema>;

/** `q` khớp `name`, mọi alias, `description.vi/en`; `feature`/`workflow` lọc theo id; sắp `name`. */
export const CommandListQuerySchema = ListQueryBase.extend({
  status: OnOffSchema.optional(),
  feature: UuidSchema.optional(),
  workflow: UuidSchema.optional(),
});
export type CommandListQuery = z.infer<typeof CommandListQuerySchema>;

/** Tính trừ bộ lọc chip `status`. */
export const CommandListCountsSchema = z.strictObject({
  all: CountSchema,
  on: CountSchema,
  off: CountSchema,
});
export type CommandListCounts = z.infer<typeof CommandListCountsSchema>;

export const CommandListResponseSchema = listResponseSchema(
  CommandListItemSchema,
  CommandListCountsSchema,
);
export type CommandListResponse = z.infer<typeof CommandListResponseSchema>;

/** Trần `groups` mỗi tenant của tab "Ai dùng được" (M3-R14). */
export const ACCESS_GROUPS_MAX = 20;

/** Tab "Ai dùng được" (M2-R23 phần tenant + M3-R14 phần group/grant). Query `ListQueryBase` (`q` khớp key/tên tenant), sắp `tenant_key`. */
export const CommandAccessItemSchema = z.strictObject({
  tenant_id: UuidSchema,
  tenant_key: TenantKeySchema,
  tenant_name: z.string().min(1),
  tenant_active: z.boolean(),
  features: z.array(
    z.strictObject({ id: UuidSchema, key: NameRef, name: LocalizedTextSchema(FEATURE_NAME_MAX) }),
  ),
  active_user_count: CountSchema,
  /** M3-R14: cặp group–feature của command đang được cấp (feature on|beta, entitlement chưa thu hồi), ≤ 20, sắp group key rồi feature key. */
  groups: z
    .array(
      refineBeta(
        z.strictObject({
          ...groupRefShape,
          feature: z.strictObject({
            id: UuidSchema,
            key: NameRef,
            name: LocalizedTextSchema(FEATURE_NAME_MAX),
          }),
        }),
      ),
    )
    .max(ACCESS_GROUPS_MAX),
  /** Tổng số cặp group–feature (trước khi cắt 20). */
  group_count: CountSchema,
  /** Số user thấy thật theo M3-R11 (= đếm từ effective-access). */
  visible_user_count: CountSchema,
});
export type CommandAccessItem = z.infer<typeof CommandAccessItemSchema>;

/** `command_active = command.enabled && workflow.enabled`. */
export const CommandAccessResponseSchema = z.strictObject({
  items: z.array(CommandAccessItemSchema),
  total: CountSchema,
  command_active: z.boolean(),
});
export type CommandAccessResponse = z.infer<typeof CommandAccessResponseSchema>;
