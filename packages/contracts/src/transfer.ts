// ADM-FR-54 · ADM-BR-04 · M4-R14 · M4-R15 · contract Import/Export cấu hình (plan-cd §3). Chỉ platform_admin.
// Tham chiếu bằng key/tên, không id; secret chỉ tên (không giá trị/last4). Strict mọi cấp (khoá lạ → lỗi).
// Không import I/O: admin-web dùng lại để kiểm file trước khi gửi.
import { z } from "zod";
import {
  AliasesSchema,
  ArgsSchema,
  CommandDescSchema,
  CommandNameSchema,
  CommandOutputSchema,
  InputMapSchema,
  TimeoutSchema,
} from "./commands";
import {
  AppTypeSchema,
  CatalogKeySchema,
  CommandModeSchema,
  CountSchema,
  FEATURE_COMMANDS_MAX,
  FeatureStatusSchema,
  IsoDateTime,
  SecretNameSchema,
  TenantKeySchema,
  TenantNameSchema,
  uniqueArray,
} from "./common";
import { FeatureDescSchema, FeatureIconSchema, FeatureNameSchema } from "./features";
import { GroupDescriptionSchema, GroupKeySchema, GroupNameSchema } from "./groups";
import { MoneyLimitSchema, QUOTA_MAX_ITEMS, QUOTA_MAX_RUNS, QUOTA_MAX_TOKENS } from "./quotas";
import { SecretValueSchema } from "./secrets";
import { MaxConcurrentSubSchema } from "./tenants";
import {
  BaseUrlSchema,
  InputSchemaSchema,
  OutputFieldSchema,
  WorkflowDescSchema,
  WorkflowNameSchema,
} from "./workflows";

export const CONFIG_FILE_FORMAT = "ai-system/config";
export const CONFIG_FORMAT_VERSION = 1;
/** Trần nội dung file import (UTF-8 byte); vượt → 413 `PAYLOAD_TOO_LARGE {max_bytes}`. */
export const IMPORT_MAX_BYTES = 1_048_576;
export const IMPORT_ERRORS_MAX = 100;
export const IMPORT_SECRETS_MAX = 500;
export const IMPORT_FILE_NAME_MAX = 255;
export const TRANSFER_LIMITS = {
  secrets: 500,
  workflows: 2000,
  commands: 2000,
  features: 500,
  tenants: 2000,
  groups: 2000,
  grants: 5000,
} as const;

export const TRANSFER_TYPES = [
  "workflows",
  "commands",
  "features",
  "tenants",
  "groups",
  "grants",
] as const;
export const TransferTypeSchema = z.enum(TRANSFER_TYPES);
export type TransferType = z.infer<typeof TransferTypeSchema>;

// ---- File cấu hình (§3.2) ----
export const SecretElSchema = z.strictObject({ name: SecretNameSchema });

export const WorkflowElSchema = z.strictObject({
  key: CatalogKeySchema,
  name: WorkflowNameSchema,
  description: WorkflowDescSchema,
  app_type: AppTypeSchema,
  base_url: BaseUrlSchema,
  secret: SecretNameSchema,
  input_schema: InputSchemaSchema,
  output_field: OutputFieldSchema,
  enabled: z.boolean(),
});
export type WorkflowEl = z.infer<typeof WorkflowElSchema>;

/** Không có `feature_ids`: thành viên feature chỉ khai ở `features[].commands`. */
export const CommandElSchema = z
  .strictObject({
    name: CommandNameSchema,
    aliases: AliasesSchema,
    description: CommandDescSchema,
    workflow: CatalogKeySchema,
    args: ArgsSchema,
    input_map: InputMapSchema,
    output: CommandOutputSchema,
    mode: CommandModeSchema,
    timeout_s: TimeoutSchema,
    enabled: z.boolean(),
  })
  .refine((v) => !v.aliases.includes(v.name), {
    message: "alias must differ from name",
    path: ["aliases"],
  });
export type CommandEl = z.infer<typeof CommandElSchema>;

/** `commands` = thay cả tập của feature (như PATCH `command_ids`). */
export const FeatureElSchema = z.strictObject({
  key: CatalogKeySchema,
  name: FeatureNameSchema,
  description: FeatureDescSchema,
  icon: FeatureIconSchema,
  status: FeatureStatusSchema,
  commands: uniqueArray(CommandNameSchema, FEATURE_COMMANDS_MAX),
});
export type FeatureEl = z.infer<typeof FeatureElSchema>;

/** Giới hạn vắng = null (không giới hạn); dòng mọi giới hạn null → lỗi (R02). `feature` null = cả tenant. */
export const QuotaEntrySchema = z
  .strictObject({
    feature: CatalogKeySchema.nullable(),
    max_runs: z.number().int().min(1).max(QUOTA_MAX_RUNS).nullable().default(null),
    max_tokens: z.number().int().min(1).max(QUOTA_MAX_TOKENS).nullable().default(null),
    max_usd: MoneyLimitSchema.nullable().default(null),
  })
  .refine((q) => q.max_runs !== null || q.max_tokens !== null || q.max_usd !== null, {
    message: "at least one limit is required",
    path: ["max_runs"],
  });
export type QuotaEntry = z.infer<typeof QuotaEntrySchema>;

/** `entitlements` chỉ thêm (không thu hồi); quota upsert theo (tenant, feature). Không có tenant `platform`. */
export const TenantElSchema = z.strictObject({
  key: TenantKeySchema,
  name: TenantNameSchema,
  max_concurrent_sub: MaxConcurrentSubSchema,
  entitlements: uniqueArray(CatalogKeySchema, TRANSFER_LIMITS.features),
  quotas: z.array(QuotaEntrySchema).max(QUOTA_MAX_ITEMS),
});
export type TenantEl = z.infer<typeof TenantElSchema>;

export const GroupElSchema = z.strictObject({
  tenant: TenantKeySchema,
  key: GroupKeySchema,
  name: GroupNameSchema,
  description: GroupDescriptionSchema.nullable(),
});
export type GroupEl = z.infer<typeof GroupElSchema>;

/** Chỉ grant cho group (user không chuyển môi trường). */
export const GrantElSchema = z.strictObject({
  tenant: TenantKeySchema,
  group: GroupKeySchema,
  feature: CatalogKeySchema,
});
export type GrantEl = z.infer<typeof GrantElSchema>;

const bodyShape = {
  workflows: z.array(WorkflowElSchema).max(TRANSFER_LIMITS.workflows).optional(),
  commands: z.array(CommandElSchema).max(TRANSFER_LIMITS.commands).optional(),
  features: z.array(FeatureElSchema).max(TRANSFER_LIMITS.features).optional(),
  tenants: z.array(TenantElSchema).max(TRANSFER_LIMITS.tenants).optional(),
  groups: z.array(GroupElSchema).max(TRANSFER_LIMITS.groups).optional(),
  grants: z.array(GrantElSchema).max(TRANSFER_LIMITS.grants).optional(),
};
export const ConfigFileBodySchema = z.strictObject(bodyShape);
export type ConfigFileBody = z.infer<typeof ConfigFileBodySchema>;

/** Khoá vắng = loại đó không có (không xoá gì). */
export const ConfigFileSchema = z.strictObject({
  format: z.literal(CONFIG_FILE_FORMAT),
  format_version: z.literal(CONFIG_FORMAT_VERSION),
  config_version: CountSchema,
  exported_at: IsoDateTime,
  secrets: z.array(SecretElSchema).max(TRANSFER_LIMITS.secrets).optional(),
  ...bodyShape,
});
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// ---- Export (§3.1) ----
/** `types` = CSV, ≥ 1, không trùng; sai → 400 `VALIDATION_ERROR`. */
export const ExportQuerySchema = z.strictObject({
  types: z
    .string()
    .transform((s) => s.split(","))
    .pipe(z.array(TransferTypeSchema).min(1))
    .refine((a) => new Set(a).size === a.length, { message: "duplicate type" }),
});
export type ExportQuery = z.infer<typeof ExportQuerySchema>;

export const ExportMetaSchema = z.strictObject({
  config_version: CountSchema,
  counts: z.strictObject({
    workflows: CountSchema,
    commands: CountSchema,
    features: CountSchema,
    tenants: CountSchema,
    groups: CountSchema,
    grants: CountSchema,
  }),
});
export type ExportMeta = z.infer<typeof ExportMetaSchema>;

// ---- Import (§3.3) ----
const YAML_FILE_RE = /\.ya?ml$/i;

export const ImportRequestSchema = z.strictObject({
  file_name: z
    .string()
    .min(1)
    .max(IMPORT_FILE_NAME_MAX)
    .refine((v) => YAML_FILE_RE.test(v), { message: "must end with .yaml or .yml" }),
  /** Kích thước kiểm ở service (413), không ở đây. */
  content: z.string(),
  secrets: z
    .record(SecretNameSchema, SecretValueSchema)
    .refine((r) => Object.keys(r).length <= IMPORT_SECRETS_MAX, { message: "too many secrets" })
    .optional(),
  base_config_version: CountSchema.optional(),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ImportQuerySchema = z.strictObject({ dry_run: z.enum(["1", "0"]).default("1") });
export type ImportQuery = z.infer<typeof ImportQuerySchema>;

export const IMPORT_ERROR_CODES = [
  "YAML_SYNTAX",
  "SCHEMA",
  "DUPLICATE_KEY",
  "REF_NOT_FOUND",
  "TENANT_NOT_FOUND",
  "PLATFORM_TENANT",
  "COMMAND_NEEDS_FEATURE",
  "NOT_ENTITLED",
  "RULE",
  "TOO_MANY_ERRORS",
] as const;
export const ImportErrorCodeSchema = z.enum(IMPORT_ERROR_CODES);
export type ImportErrorCode = z.infer<typeof ImportErrorCodeSchema>;

export const ImportErrorSchema = z.strictObject({
  path: z.string(),
  code: ImportErrorCodeSchema,
  message: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  line: z.number().int().min(1).optional(),
  col: z.number().int().min(1).optional(),
});
export type ImportError = z.infer<typeof ImportErrorSchema>;

export const IMPORT_ITEM_TYPES = [
  "workflow",
  "command",
  "feature",
  "tenant",
  "group",
  "grant",
] as const;
export const ImportItemTypeSchema = z.enum(IMPORT_ITEM_TYPES);
export type ImportItemType = z.infer<typeof ImportItemTypeSchema>;

const ObjectSchema = z.record(z.string(), z.unknown());
/** Chỉ mục đổi; `key` group = `acme/sales`, grant = `acme/sales/translate`. */
export const ImportItemSchema = z.strictObject({
  type: ImportItemTypeSchema,
  key: z.string().min(1),
  op: z.enum(["add", "update"]),
  before: ObjectSchema.nullable(),
  after: ObjectSchema,
});
export type ImportItem = z.infer<typeof ImportItemSchema>;

export const ImportSummarySchema = z.strictObject({
  added: CountSchema,
  updated: CountSchema,
  unchanged: CountSchema,
});
export type ImportSummary = z.infer<typeof ImportSummarySchema>;

export const MissingSecretSchema = z.strictObject({
  name: SecretNameSchema,
  used_by: z.array(CatalogKeySchema),
});
export type MissingSecret = z.infer<typeof MissingSecretSchema>;

export const ImportPreviewSchema = z.strictObject({
  valid: z.boolean(),
  file_name: z.string(),
  from_config_version: CountSchema.nullable(),
  base_config_version: CountSchema,
  summary: ImportSummarySchema,
  items: z.array(ImportItemSchema),
  missing_secrets: z.array(MissingSecretSchema),
  errors: z.array(ImportErrorSchema).max(IMPORT_ERRORS_MAX),
});
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;

export const ImportResultSchema = z.strictObject({
  config_version: CountSchema,
  summary: ImportSummarySchema,
  secrets_created: CountSchema,
});
export type ImportResult = z.infer<typeof ImportResultSchema>;

// ---- details của lỗi C (§3.3) ----
export const PayloadTooLargeDetailsSchema = z.strictObject({ max_bytes: CountSchema });
export const ImportInvalidDetailsSchema = z.strictObject({ errors: z.array(ImportErrorSchema) });
export const SecretsRequiredDetailsSchema = z.strictObject({ missing: z.array(SecretNameSchema) });
