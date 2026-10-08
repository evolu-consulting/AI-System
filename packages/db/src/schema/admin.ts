// ADM-NFR-06, ADM-NFR-07, ADM-FR-63 · schema `admin` M1 (spec M1 §4): tenants, users, refresh_tokens, features.
// ADM-FR-62 · M3: `users_tenant_id_uq`; 4 bảng quyền ở `schema/permissions.ts`.
// ADM-FR-51 · M4: `tenants.updated_by`, `users.updated_by` (M4-R17); 3 bảng vận hành ở `schema/ops.ts`.
// ADM-FR-10, ADM-FR-20, ADM-FR-30, ADM-FR-31, ADM-FR-50 · + 6 bảng catalog M2 và `features.updated_by` (spec M2 §4).
// RLS, policy, role `admin_api`, hàm SECURITY DEFINER nằm ở migration custom 0002_admin_rls (không khai ở đây).
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const admin = pgSchema("admin");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const tsz = (name: string) => timestamp(name, { withTimezone: true });
const versionCol = () => integer("version").notNull().default(1);
const audit = () => ({
  createdAt: tsz("created_at").notNull().defaultNow(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});
/** M2: người ghi gần nhất; xoá user giữ hàng (`SET NULL`). `users` tham chiếu lười nên khai trước được. */
const updatedBy = () =>
  uuid("updated_by").references((): AnyPgColumn => users.id, { onDelete: "set null" });

export const tenants = admin.table(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    maxConcurrentSub: integer("max_concurrent_sub"),
    settings: jsonb("settings").notNull().default({}),
    version: versionCol(),
    ...audit(),
    updatedBy: updatedBy(),
  },
  (t) => [
    uniqueIndex("tenants_key_uq").on(t.key),
    check("tenants_key_check", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("tenants_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 128`),
    check(
      "tenants_max_concurrent_sub_check",
      sql`${t.maxConcurrentSub} IS NULL OR ${t.maxConcurrentSub} BETWEEN 1 AND 10000`,
    ),
    check("tenants_version_check", sql`${t.version} >= 1`),
  ],
);

export const users = admin.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    username: text("username").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["platform_admin", "tenant_admin", "member"] }).notNull(),
    locale: text("locale", { enum: ["vi", "en"] })
      .notNull()
      .default("en"),
    active: boolean("active").notNull().default(true),
    lockedByTenant: boolean("locked_by_tenant").notNull().default(false),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedLogins: smallint("failed_logins").notNull().default(0),
    lockedUntil: tsz("locked_until"),
    lastLoginAt: tsz("last_login_at"),
    passwordChangedAt: tsz("password_changed_at").notNull().defaultNow(),
    version: versionCol(),
    ...audit(),
    updatedBy: updatedBy(),
  },
  (t) => [
    uniqueIndex("users_tenant_username_uq").on(t.tenantId, t.username),
    // M3: đích FK kép (tenant_id, user_id) của group_members/feature_grants (spec M3 §4).
    unique("users_tenant_id_uq").on(t.tenantId, t.id),
    uniqueIndex("users_tenant_email_uq")
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} IS NOT NULL`),
    index("users_tenant_role_active_idx").on(t.tenantId, t.role).where(sql`${t.active}`),
    index("users_username_idx").on(t.username, t.id),
    check("users_username_check", sql`${t.username} ~ '^[a-z0-9._-]{2,32}$'`),
    check("users_email_check", sql`char_length(${t.email}) <= 254`),
    check("users_display_name_check", sql`char_length(${t.displayName}) BETWEEN 1 AND 64`),
    check("users_role_check", sql`${t.role} IN ('platform_admin', 'tenant_admin', 'member')`),
    check(
      "users_tenant_admin_email_check",
      sql`${t.role} <> 'tenant_admin' OR ${t.email} IS NOT NULL`,
    ),
    check("users_locale_check", sql`${t.locale} IN ('vi', 'en')`),
    check("users_failed_logins_check", sql`${t.failedLogins} >= 0`),
    check("users_version_check", sql`${t.version} >= 1`),
  ],
);

export const REVOKE_REASONS = [
  "rotated",
  "reuse",
  "logout",
  "logout_all",
  "user_locked",
  "tenant_locked",
  "password_changed",
  "password_reset",
] as const;

export const refreshTokens = admin.table(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    client: text("client", { enum: ["web", "extension"] }).notNull(),
    userAgent: text("user_agent"),
    expiresAt: tsz("expires_at").notNull(),
    revokedAt: tsz("revoked_at"),
    revokedReason: text("revoked_reason", { enum: REVOKE_REASONS }),
    replacedBy: uuid("replaced_by"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash),
    index("refresh_tokens_user_active_idx").on(t.userId).where(sql`${t.revokedAt} IS NULL`),
    index("refresh_tokens_tenant_active_idx").on(t.tenantId).where(sql`${t.revokedAt} IS NULL`),
    index("refresh_tokens_family_idx").on(t.familyId),
    check("refresh_tokens_hash_len_check", sql`octet_length(${t.tokenHash}) = 32`),
    check("refresh_tokens_client_check", sql`${t.client} IN ('web', 'extension')`),
    check(
      "refresh_tokens_revoked_reason_check",
      sql`${t.revokedReason} IN ('rotated', 'reuse', 'logout', 'logout_all', 'user_locked', 'tenant_locked', 'password_changed', 'password_reset')`,
    ),
    check(
      "refresh_tokens_revoked_pair_check",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedReason} IS NULL)`,
    ),
    check("refresh_tokens_user_agent_check", sql`char_length(${t.userAgent}) <= 512`),
  ],
);

export const features = admin.table(
  "features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: jsonb("name").notNull(),
    description: jsonb("description").notNull().default({}),
    icon: text("icon"),
    status: text("status", { enum: ["on", "off", "beta"] })
      .notNull()
      .default("on"),
    version: versionCol(),
    ...audit(),
    updatedBy: updatedBy(),
  },
  (t) => [
    uniqueIndex("features_key_uq").on(t.key),
    check("features_key_check", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("features_status_check", sql`${t.status} IN ('on', 'off', 'beta')`),
    check("features_version_check", sql`${t.version} >= 1`),
  ],
);

// ---- M2 catalog (spec M2 §4): secrets, workflows, commands, command_names, feature_commands, feature_entitlements.
// RLS/quyền cột/REVOKE của secrets + feature_entitlements nằm ở migration custom 0004_catalog_rls.

/** Bản mã AES-256-GCM (‖ tag 16 byte); admin_rw không SELECT được `ciphertext`/`iv` (0004). */
export const secrets = admin.table(
  "secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    keyVersion: smallint("key_version").notNull().default(1),
    last4: text("last4").notNull(),
    note: text("note"),
    ...audit(),
    updatedBy: updatedBy(),
  },
  (t) => [
    uniqueIndex("secrets_name_uq").on(t.name),
    check("secrets_name_check", sql`${t.name} ~ '^[A-Z0-9_]{2,64}$'`),
    check("secrets_ciphertext_check", sql`octet_length(${t.ciphertext}) BETWEEN 24 AND 6160`),
    check("secrets_iv_check", sql`octet_length(${t.iv}) = 12`),
    check("secrets_key_version_check", sql`${t.keyVersion} >= 1`),
    check("secrets_last4_check", sql`char_length(${t.last4}) = 4`),
    check("secrets_note_check", sql`char_length(${t.note}) <= 200`),
  ],
);

export const workflows = admin.table(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    appType: text("app_type", { enum: ["workflow", "chat", "agent"] }).notNull(),
    baseUrl: text("base_url").notNull(),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "restrict" }),
    inputSchema: jsonb("input_schema").notNull().default([]),
    outputField: text("output_field"),
    enabled: boolean("enabled").notNull().default(true),
    // X1 · HUB-FR-95: cờ tác dụng phụ (Hub đọc cột này thay hub.workflow_flags).
    sideEffect: boolean("side_effect").notNull().default(false),
    version: versionCol(),
    ...audit(),
    updatedBy: updatedBy(),
  },
  (t) => [
    uniqueIndex("workflows_key_uq").on(t.key),
    index("workflows_secret_idx").on(t.secretId),
    check("workflows_key_check", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("workflows_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 128`),
    check("workflows_description_check", sql`char_length(${t.description}) BETWEEN 20 AND 400`),
    check("workflows_app_type_check", sql`${t.appType} IN ('workflow', 'chat', 'agent')`),
    check(
      "workflows_base_url_check",
      sql`char_length(${t.baseUrl}) <= 2048 AND ${t.baseUrl} ~ '^https?://'`,
    ),
    check("workflows_input_schema_check", sql`jsonb_typeof(${t.inputSchema}) = 'array'`),
    check("workflows_output_field_check", sql`char_length(${t.outputField}) BETWEEN 1 AND 128`),
    check("workflows_version_check", sql`${t.version} >= 1`),
  ],
);

export const commands = admin.table(
  "commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    description: jsonb("description").notNull(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "restrict" }),
    args: jsonb("args").notNull().default([]),
    inputMap: jsonb("input_map").notNull().default({}),
    output: jsonb("output").notNull(),
    mode: text("mode", { enum: ["sync", "async"] })
      .notNull()
      .default("sync"),
    timeoutS: integer("timeout_s").notNull().default(30),
    enabled: boolean("enabled").notNull().default(true),
    version: versionCol(),
    ...audit(),
    updatedBy: updatedBy(),
  },
  (t) => [
    uniqueIndex("commands_name_uq").on(t.name),
    index("commands_workflow_idx").on(t.workflowId),
    check("commands_name_check", sql`${t.name} ~ '^[a-z0-9-]{2,32}$'`),
    check("commands_aliases_check", sql`cardinality(${t.aliases}) <= 5`),
    check(
      "commands_description_check",
      sql`jsonb_typeof(${t.description}) = 'object' AND ${t.description} ? 'vi'`,
    ),
    check("commands_args_check", sql`jsonb_typeof(${t.args}) = 'array'`),
    check("commands_input_map_check", sql`jsonb_typeof(${t.inputMap}) = 'object'`),
    check("commands_output_check", sql`jsonb_typeof(${t.output}) = 'object'`),
    check("commands_mode_check", sql`${t.mode} IN ('sync', 'async')`),
    check("commands_timeout_s_check", sql`${t.timeoutS} BETWEEN 1 AND 600`),
    check("commands_version_check", sql`${t.version} >= 1`),
  ],
);

/** Không gian tên chung tên + alias command (M2-R13): PK `command_names_pkey` bảo đảm unique. */
export const commandNames = admin.table(
  "command_names",
  {
    name: text("name").primaryKey(),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("command_names_command_idx").on(t.commandId),
    check("command_names_name_check", sql`${t.name} ~ '^[a-z0-9-]{2,32}$'`),
  ],
);

export const featureCommands = admin.table(
  "feature_commands",
  {
    featureId: uuid("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "feature_commands_pkey", columns: [t.featureId, t.commandId] }),
    index("feature_commands_command_idx").on(t.commandId),
  ],
);

/** Thu hồi = đặt `revoked_at` (không xoá hàng, BR-12); `core` không có hàng (tự hiệu lực). */
export const featureEntitlements = admin.table(
  "feature_entitlements",
  {
    featureId: uuid("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: tsz("granted_at").notNull().defaultNow(),
    revokedAt: tsz("revoked_at"),
  },
  (t) => [
    primaryKey({ name: "feature_entitlements_pkey", columns: [t.featureId, t.tenantId] }),
    index("feature_entitlements_tenant_active_idx")
      .on(t.tenantId, t.featureId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
