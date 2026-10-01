// ADM-NFR-06, ADM-NFR-07, ADM-FR-63 · schema `admin` M1 (spec M1 §4): tenants, users, refresh_tokens, features.
// RLS, policy, role `admin_api`, hàm SECURITY DEFINER nằm ở migration custom 0002_admin_rls (không khai ở đây).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
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
      .default("vi"),
    active: boolean("active").notNull().default(true),
    lockedByTenant: boolean("locked_by_tenant").notNull().default(false),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedLogins: smallint("failed_logins").notNull().default(0),
    lockedUntil: tsz("locked_until"),
    lastLoginAt: tsz("last_login_at"),
    passwordChangedAt: tsz("password_changed_at").notNull().defaultNow(),
    version: versionCol(),
    ...audit(),
  },
  (t) => [
    uniqueIndex("users_tenant_username_uq").on(t.tenantId, t.username),
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
  },
  (t) => [
    uniqueIndex("features_key_uq").on(t.key),
    check("features_key_check", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("features_status_check", sql`${t.status} IN ('on', 'off', 'beta')`),
    check("features_version_check", sql`${t.version} >= 1`),
  ],
);
