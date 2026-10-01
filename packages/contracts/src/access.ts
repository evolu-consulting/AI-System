// ADM-FR-36, ADM-BR-11, ADM-BR-12 · contract GET /admin/users/:id/effective-access (spec M3 §3 "Kiểm tra quyền",
// M3-R11, R12). Luật tính = `computeEffectiveAccess` (admin-api access.rules) = SQL tham chiếu của Hub (plan §3.2).
import { z } from "zod";
import {
  CATALOG_KEY_RE,
  COMMAND_DESC_MAX,
  CountSchema,
  EntityStatusSchema,
  FEATURE_NAME_MAX,
  LocalizedTextSchema,
  TenantKeySchema,
  USERNAME_RE,
  UuidSchema,
} from "./common";
import { GrantFeatureRefSchema } from "./grants";
import { GroupRefSchema, USER_GROUPS_MAX } from "./groups";

export const ACCESS_COMMANDS_MAX = 1000;
export const ACCESS_REASONS = ["core", "grant_user", "grant_group", "beta_member"] as const;
export const USER_BLOCKERS = ["user_inactive", "tenant_locked"] as const;
export const FEATURE_MISSING = [
  ...USER_BLOCKERS,
  "feature_off",
  "beta_not_member",
  "no_entitlement",
  "no_grant",
] as const;
export const COMMAND_MISSING = [
  ...USER_BLOCKERS,
  "command_disabled",
  "workflow_disabled",
  "no_effective_feature",
] as const;
/** Lý do chặn ở mức feature, không gồm USER_BLOCKERS (đã ở `blockers`) — dùng trong `blocked_by`. */
export const FEATURE_ONLY_MISSING = [
  "feature_off",
  "beta_not_member",
  "no_entitlement",
  "no_grant",
] as const;

export const UserBlockerSchema = z.enum(USER_BLOCKERS);
export type UserBlocker = z.infer<typeof UserBlockerSchema>;
export const FeatureMissingSchema = z.enum(FEATURE_MISSING);
export type FeatureMissing = z.infer<typeof FeatureMissingSchema>;
export const CommandMissingSchema = z.enum(COMMAND_MISSING);
export type CommandMissing = z.infer<typeof CommandMissingSchema>;
export const FeatureOnlyMissingSchema = z.enum(FEATURE_ONLY_MISSING);
export type FeatureOnlyMissing = z.infer<typeof FeatureOnlyMissingSchema>;

export const AccessReasonSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("core") }),
  z.strictObject({ code: z.literal("grant_user") }),
  z.strictObject({ code: z.literal("grant_group"), group: GroupRefSchema }),
  z.strictObject({ code: z.literal("beta_member") }),
]);
export type AccessReason = z.infer<typeof AccessReasonSchema>;

export const FeatureMiniSchema = z.strictObject({
  id: UuidSchema,
  key: z.string().regex(CATALOG_KEY_RE),
  name: LocalizedTextSchema(FEATURE_NAME_MAX),
});
export type FeatureMini = z.infer<typeof FeatureMiniSchema>;

/** `effective ⇔ missing = []`; `reasons` có cả khi không hiệu lực (vd grant giữ khi `no_entitlement`, A11). */
export const EffectiveFeatureSchema = z
  .strictObject({
    feature: GrantFeatureRefSchema,
    effective: z.boolean(),
    reasons: z.array(AccessReasonSchema),
    missing: z.array(FeatureMissingSchema),
  })
  .refine((f) => f.effective === (f.missing.length === 0), {
    message: "effective must equal missing.length === 0",
    path: ["effective"],
  });
export type EffectiveFeature = z.infer<typeof EffectiveFeatureSchema>;

/** `visible ⇔ missing = []`; `suggestion` khác null ⇔ không thấy chỉ vì thiếu grant ở một feature (F4). */
export const EffectiveCommandSchema = z
  .strictObject({
    id: UuidSchema,
    name: z.string().regex(CATALOG_KEY_RE),
    aliases: z.array(z.string().regex(CATALOG_KEY_RE)),
    description: LocalizedTextSchema(COMMAND_DESC_MAX),
    visible: z.boolean(),
    via: z.array(
      z.strictObject({ feature: FeatureMiniSchema, reasons: z.array(AccessReasonSchema) }),
    ),
    blocked_by: z.array(
      z.strictObject({ feature: FeatureMiniSchema, missing: z.array(FeatureOnlyMissingSchema) }),
    ),
    missing: z.array(CommandMissingSchema),
    suggestion: z
      .strictObject({ action: z.literal("grant_feature"), feature: FeatureMiniSchema })
      .nullable(),
  })
  .refine((c) => c.visible === (c.missing.length === 0), {
    message: "visible must equal missing.length === 0",
    path: ["visible"],
  });
export type EffectiveCommand = z.infer<typeof EffectiveCommandSchema>;

export const EffectiveAccessSchema = z.strictObject({
  user: z.strictObject({
    id: UuidSchema,
    username: z.string().regex(USERNAME_RE),
    display_name: z.string().min(1),
    tenant_id: UuidSchema,
    tenant_key: TenantKeySchema,
    status: EntityStatusSchema,
    groups: z.array(GroupRefSchema).max(USER_GROUPS_MAX),
  }),
  blockers: z.array(UserBlockerSchema),
  /** Mọi feature catalog, `core` đầu rồi key. */
  features: z.array(EffectiveFeatureSchema),
  /** Sắp `name`, ≤ 1.000; `command_total` = tổng trước khi cắt. */
  commands: z.array(EffectiveCommandSchema).max(ACCESS_COMMANDS_MAX),
  command_total: CountSchema,
  agents: z.strictObject({ available: z.literal(false) }),
  config_version: CountSchema,
});
export type EffectiveAccess = z.infer<typeof EffectiveAccessSchema>;

/** trim → lower → bỏ một `/` đầu → CATALOG_KEY_RE; khớp name hoặc alias, không khớp → `commands: []` (không 404). */
export const EffectiveAccessQuerySchema = z.strictObject({
  command: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => s.replace(/^\//, ""))
    .pipe(z.string().regex(CATALOG_KEY_RE))
    .optional(),
});
export type EffectiveAccessQuery = z.infer<typeof EffectiveAccessQuerySchema>;
