// ADM-FR-01, ADM-FR-04, ADM-FR-60, ADM-FR-63, ADM-BR-05 · kiểu dùng chung, hằng và bảng mã lỗi M1 (spec M1 §3).
// ADM-FR-10, ADM-FR-20, ADM-FR-30, ADM-FR-50 · hằng/enum catalog M2, kiểu chung và 11 mã lỗi M2 (spec M2 §3).
// ADM-FR-62, ADM-FR-32 · 2 mã lỗi M3 + `REFERENCE_FIELDS` mở rộng (spec M3 §3).
// Không import I/O: file này chạy được ở trình duyệt (admin-web dùng regex/hằng để validate form).
import { z } from "zod";

export const COMPANY_KEY_RE = /^[a-z0-9-]{2,32}$/;
export const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
export const TEMP_PASSWORD_RE = /^[A-Za-z0-9]{16}$/;
export const PASSWORD_MIN_LEN = 10;
export const PASSWORD_MAX_LEN = 128;
export const DISPLAY_NAME_MAX = 64;
export const NAME_MAX = 128;
export const EMAIL_MAX = 254;
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 200;
export const LIST_OFFSET_MAX = 100_000;
export const LIST_Q_MAX = 100;
export const TEMP_PASSWORD_LEN = 16;
export const MAX_CONCURRENT_SUB_MAX = 10_000;
/** Key agent (`hub.agents.key`), chép từ `hub/common` để kênh chat không import `../hub` (H2b plan §2.1). */
export const AGENT_KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

export const ROLES = ["platform_admin", "tenant_admin", "member"] as const;
export const LOCALES = ["vi", "en"] as const;
export const ENTITY_STATUSES = ["active", "locked"] as const;

export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;
export const EntityStatusSchema = z.enum(ENTITY_STATUSES);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

/** ISO 8601 UTC (hậu tố `Z`), không nhận offset khác. */
export const IsoDateTime = z.iso.datetime();
export const UuidSchema = z.uuid();

export const TenantKeySchema = z.string().trim().toLowerCase().regex(COMPANY_KEY_RE);
export const UsernameSchema = z.string().trim().toLowerCase().regex(USERNAME_RE);
// Trim/lowercase trước rồi mới kiểm định dạng email (format check của z.email() chạy trước transform).
export const EmailSchema = z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email());
export const DisplayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX);
export const TenantNameSchema = z.string().trim().min(1).max(NAME_MAX);
/** Mật khẩu không trim: khoảng trắng là ký tự hợp lệ. */
export const NewPasswordSchema = z.string().min(PASSWORD_MIN_LEN).max(PASSWORD_MAX_LEN);
export const VersionSchema = z.number().int().min(1);
export const TempPasswordSchema = z.string().regex(TEMP_PASSWORD_RE);
export const CountSchema = z.number().int().min(0);

export type TenantKey = z.infer<typeof TenantKeySchema>;
export type Username = z.infer<typeof UsernameSchema>;
export type Email = z.infer<typeof EmailSchema>;

// ---- M2 catalog (spec M2 §3): hằng/regex/enum dùng chung BE/FE ----
export const SECRET_NAME_RE = /^[A-Z0-9_]{2,64}$/;
export const SECRET_VALUE_MIN = 8;
export const SECRET_VALUE_MAX = 2048;
export const SECRET_NOTE_MAX = 200;
/** Key workflow, key feature, tên + alias command (= `COMPANY_KEY_RE`). */
export const CATALOG_KEY_RE = COMPANY_KEY_RE;
export const WORKFLOW_DESC_MIN = 20;
export const WORKFLOW_DESC_MAX = 400;
export const INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const INPUT_SCHEMA_MAX = 50;
export const INPUT_DESC_MAX = 400;
export const SELECT_OPTIONS_MAX = 50;
export const SELECT_OPTION_MAX = 100;
export const ARG_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const ARGS_MAX = 20;
export const ALIASES_MAX = 5;
export const COMMAND_DESC_MAX = 200;
export const CONST_VALUE_MAX = 4000;
export const ARG_DEFAULT_MAX = 1000;
export const TIMEOUT_MIN_S = 1;
export const TIMEOUT_MAX_S = 600;
export const TIMEOUT_DEFAULT_S = { sync: 30, async: 120 } as const;
export const COMMAND_FEATURES_MAX = 50;
export const FEATURE_COMMANDS_MAX = 500;
export const FEATURE_NAME_MAX = 64;
export const FEATURE_DESC_MAX = 400;
export const FEATURE_ICON_RE = /^[a-z0-9-]{1,40}$/;
export const FEATURE_ICON_DEFAULT = "package";
export const CORE_FEATURE_KEY = "core";
export const BASE_URL_MAX = 2048;
export const OUTPUT_FIELD_MAX = 128;
/** Trần mảng `commands`/`agents` của `WorkflowUsages`. */
export const USAGES_MAX = 200;

export const APP_TYPES = ["workflow", "chat", "agent"] as const;
export const INPUT_TYPES = ["text", "number", "boolean", "select", "file"] as const;
export const COMMAND_MODES = ["sync", "async"] as const;
export const OUTPUT_RENDERS = ["markdown", "text", "json"] as const;
export const MAP_SOURCES = [
  "arg",
  "selection",
  "page_url",
  "page_text",
  "attachment",
  "user_id",
  "tenant_id",
  "const",
] as const;
export const ARG_FALLBACKS = ["selection", "page_url", "page_text"] as const;
export const FEATURE_STATUSES = ["on", "off", "beta"] as const;
export const ON_OFF = ["on", "off"] as const;

export const AppTypeSchema = z.enum(APP_TYPES);
export type AppType = z.infer<typeof AppTypeSchema>;
export const InputTypeSchema = z.enum(INPUT_TYPES);
export type InputType = z.infer<typeof InputTypeSchema>;
export const CommandModeSchema = z.enum(COMMAND_MODES);
export type CommandMode = z.infer<typeof CommandModeSchema>;
export const OutputRenderSchema = z.enum(OUTPUT_RENDERS);
export type OutputRender = z.infer<typeof OutputRenderSchema>;
export const MapSourceSchema = z.enum(MAP_SOURCES);
export type MapSource = z.infer<typeof MapSourceSchema>;
export const ArgFallbackSchema = z.enum(ARG_FALLBACKS);
export type ArgFallback = z.infer<typeof ArgFallbackSchema>;
export const FeatureStatusSchema = z.enum(FEATURE_STATUSES);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;
export const OnOffSchema = z.enum(ON_OFF);
export type OnOff = z.infer<typeof OnOffSchema>;

/** Key catalog (workflow/feature) và tên/alias command: trim → lower → `CATALOG_KEY_RE`. */
export const CatalogKeySchema = z.string().trim().toLowerCase().regex(CATALOG_KEY_RE);
/** Tên secret ở body: trim → HOA → `SECRET_NAME_RE`. Path `:name` khớp nguyên văn, không qua đây. */
export const SecretNameSchema = z.string().trim().toUpperCase().regex(SECRET_NAME_RE);
/** Query bool chỉ nhận đúng `"true"`/`"false"`. */
export const QueryBoolSchema = z.enum(["true", "false"]).transform((v) => v === "true");
/** Username của người ghi gần nhất; `null` = seed/không rõ (spec M2 §3, Y10). */
export const UpdatedBySchema = z.string().min(1).nullable();

export type LocalizedText = { vi: string; en?: string };
export type LocalizedOptional = { vi?: string; en?: string };

/** `{vi: trim 1–max, en?: trim ≤ max}`; `en` rỗng sau trim → bỏ khoá. */
export function LocalizedTextSchema(max: number) {
  return z
    .strictObject({
      vi: z.string().trim().min(1).max(max),
      en: z.string().trim().max(max).optional(),
    })
    .transform(({ vi, en }): LocalizedText => (en ? { vi, en } : { vi }));
}

/** `{vi?, en?}` mỗi khoá trim ≤ max; rỗng sau trim → bỏ khoá. */
export function LocalizedOptionalSchema(max: number) {
  const part = z.string().trim().max(max).optional();
  return z.strictObject({ vi: part, en: part }).transform(({ vi, en }): LocalizedOptional => {
    const out: LocalizedOptional = {};
    if (vi) out.vi = vi;
    if (en) out.en = en;
    return out;
  });
}

/** Mảng ≤ max phần tử, không trùng (so `===`); trùng → issue `custom` tại vị trí lặp. */
export function uniqueArray<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .superRefine((arr, ctx) => {
      const seen = new Set<unknown>();
      arr.forEach((v, i) => {
        if (seen.has(v)) ctx.addIssue({ code: "custom", message: "duplicate", path: [i] });
        seen.add(v);
      });
    });
}

/** Query chung của list: `q` trim ≤ 100 (rỗng = bỏ), `limit` 1–200 (50), `offset` 0–100000 (0). */
export const ListQueryBase = z.strictObject({
  q: z
    .string()
    .trim()
    .max(LIST_Q_MAX)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).max(LIST_OFFSET_MAX).default(0),
});

/** `counts` tính theo cùng bộ lọc của list **trừ** `status`. */
export const ListCountsSchema = z.strictObject({
  all: CountSchema,
  active: CountSchema,
  locked: CountSchema,
});
export type ListCounts = z.infer<typeof ListCountsSchema>;

/** `counts` mặc định = `ListCountsSchema` (M1); thực thể M2 truyền schema counts riêng. */
export function listResponseSchema<
  T extends z.ZodType,
  C extends z.ZodType = typeof ListCountsSchema,
>(item: T, counts?: C) {
  const c = (counts ?? ListCountsSchema) as C;
  return z.strictObject({ items: z.array(item), total: CountSchema, counts: c });
}
export type ListResponse<T, C = ListCounts> = { items: T[]; total: number; counts: C };

/** List không có `counts` (entitlement, access): `{items, total}`. */
export function pageResponseSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), total: CountSchema });
}
export type PageResponse<T> = { items: T[]; total: number };

/** Nguồn duy nhất mã lỗi → HTTP status cho BE/FE/QC (spec M1 §3 + M2 §3 + M3 §3 + M4 A/B + C + D: 23 + 11 + 2 + 3 + 3 + 6 = 48 mã; CR-055 gỡ COMMAND_NEEDS_FEATURE, FEATURE_HAS_EXCLUSIVE_COMMANDS → 46). */
export const API_ERRORS = {
  VALIDATION_ERROR: 400,
  TENANT_REQUIRED: 400,
  ROLE_NOT_ALLOWED: 400,
  EMAIL_REQUIRED: 400,
  PASSWORD_UNCHANGED: 400,
  INVALID_CURRENT_PASSWORD: 400,
  INVALID_REFERENCE: 400,
  INPUT_MAP_INVALID: 400,
  INVALID_CURRENT_CODE: 400,
  IMPORT_INVALID: 400,
  SECRETS_REQUIRED: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_REFRESH_TOKEN: 401,
  REFRESH_SUPERSEDED: 401,
  INVALID_CHANGE_TOKEN: 401,
  INVALID_TOTP_TOKEN: 401,
  INVALID_OTP: 401,
  FORBIDDEN: 403,
  ACCOUNT_LOCKED: 403,
  SELF_ACTION_FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  KEY_TAKEN: 409,
  USERNAME_TAKEN: 409,
  EMAIL_TAKEN: 409,
  LAST_ADMIN: 409,
  PLATFORM_TENANT_LOCKED: 409,
  SECRET_NAME_TAKEN: 409,
  SECRET_IN_USE: 409,
  WORKFLOW_IN_USE: 409,
  SCHEMA_BREAKS_COMMANDS: 409,
  WORKFLOW_DISABLED: 409,
  COMMAND_NAME_TAKEN: 409,
  CORE_FEATURE_PROTECTED: 409,
  BETA_GROUP_PROTECTED: 409,
  NOT_ENTITLED: 409,
  NAME_TAKEN: 409,
  NOT_RESTORABLE: 409,
  RESTORE_REF_MISSING: 409,
  TOTP_ALREADY_ENABLED: 409,
  TOTP_NOT_ENABLED: 409,
  TOTP_SETUP_EXPIRED: 409,
  PAYLOAD_TOO_LARGE: 413,
  TEMP_LOCKED: 423,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, 400 | 401 | 403 | 404 | 409 | 413 | 423 | 500>;

export type ErrorCode = keyof typeof API_ERRORS;
export type ApiErrorStatus = (typeof API_ERRORS)[ErrorCode];
export const ERROR_CODES = Object.keys(API_ERRORS) as ErrorCode[];
export const ErrorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

/** `VALIDATION_ERROR.details`; JSON hỏng → `issues:[{path:[], code:"invalid_json", …}]`. */
export const ValidationErrorDetailsSchema = z.strictObject({
  issues: z.array(
    z.strictObject({
      path: z.array(z.union([z.string(), z.number()])),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetailsSchema>;

export const LastAdminDetailsSchema = z.strictObject({ scope: z.enum(["platform", "tenant"]) });
export type LastAdminDetails = z.infer<typeof LastAdminDetailsSchema>;

export const TempLockedDetailsSchema = z.strictObject({ until: IsoDateTime });
export type TempLockedDetails = z.infer<typeof TempLockedDetailsSchema>;

// ---- details của mã lỗi M2 (spec M2 §3 "Mã lỗi mới"). SECRET_NAME_TAKEN, CORE_FEATURE_PROTECTED: không details ----
const CommandNameRef = z.string().regex(CATALOG_KEY_RE);
export const CommandRefSchema = z.strictObject({ id: UuidSchema, name: CommandNameRef });
export type CommandRef = z.infer<typeof CommandRefSchema>;
export const UsageCommandSchema = z.strictObject({
  id: UuidSchema,
  name: CommandNameRef,
  enabled: z.boolean(),
});
export type UsageCommand = z.infer<typeof UsageCommandSchema>;
/** Admin chỉ biết `agent_id` (tên agent ở Hub, Mơ hồ A6). */
export const AgentRefSchema = z.strictObject({ id: UuidSchema });
export type AgentRef = z.infer<typeof AgentRefSchema>;

export const SecretInUseDetailsSchema = z.strictObject({
  used_by: z.array(z.string().regex(CATALOG_KEY_RE)).min(1),
});
export type SecretInUseDetails = z.infer<typeof SecretInUseDetailsSchema>;

/** M2: secret_id, workflow_id, feature_ids, command_ids · M3: feature_id, group_id, user_id (grant POST), group_ids (batch). */
export const REFERENCE_FIELDS = [
  "secret_id",
  "workflow_id",
  "feature_ids",
  "command_ids",
  "feature_id",
  "group_id",
  "user_id",
  "group_ids",
] as const;
export const InvalidReferenceDetailsSchema = z.strictObject({
  field: z.enum(REFERENCE_FIELDS),
  ids: z.array(UuidSchema).min(1),
});
export type InvalidReferenceDetails = z.infer<typeof InvalidReferenceDetailsSchema>;

/** `delete`: mọi command + agent; `disable`: chỉ command đang bật + mọi agent (M2-R11). */
export const WorkflowInUseDetailsSchema = z.strictObject({
  action: z.enum(["delete", "disable"]),
  commands: z.array(UsageCommandSchema),
  agents: z.array(AgentRefSchema),
});
export type WorkflowInUseDetails = z.infer<typeof WorkflowInUseDetailsSchema>;

export const SchemaBreaksCommandsDetailsSchema = z.strictObject({
  commands: z
    .array(
      z.strictObject({
        id: UuidSchema,
        name: CommandNameRef,
        missing: z.array(z.string()),
        unknown: z.array(z.string()),
      }),
    )
    .min(1),
});
export type SchemaBreaksCommandsDetails = z.infer<typeof SchemaBreaksCommandsDetailsSchema>;

export const WorkflowDisabledDetailsSchema = z.strictObject({
  workflow: z.strictObject({ id: UuidSchema, key: z.string().regex(CATALOG_KEY_RE) }),
});
export type WorkflowDisabledDetails = z.infer<typeof WorkflowDisabledDetailsSchema>;

/** `name` = tên/alias đầu tiên bị trùng theo thứ tự `[name, ...aliases]`. */
export const CommandNameTakenDetailsSchema = z.strictObject({ name: CommandNameRef });
export type CommandNameTakenDetails = z.infer<typeof CommandNameTakenDetailsSchema>;

/** Đủ 3 khoá (có thể rỗng); `message` cố định "Invalid input map", câu AC-A03 do FE dựng. */
export const InputMapInvalidDetailsSchema = z.strictObject({
  missing: z.array(z.string()),
  unknown: z.array(z.string()),
  unknown_args: z.array(z.string()),
});
export type InputMapInvalidDetails = z.infer<typeof InputMapInvalidDetailsSchema>;

/** M3-R07: feature không có entitlement chưa thu hồi ở tenant (≥ 1, sắp tăng, không trùng). */
export const NotEntitledDetailsSchema = z.strictObject({
  feature_ids: z.array(UuidSchema).min(1),
});
export type NotEntitledDetails = z.infer<typeof NotEntitledDetailsSchema>;

// HUB-FR-44 · hằng đính kèm H2c (plan H2c §2.1) — file riêng vì trần 400 dòng.
export * from "./attach";
