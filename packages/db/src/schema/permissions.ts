// ADM-FR-62, ADM-FR-32, ADM-FR-53, ADM-NFR-07 · schema `admin` M3 (spec M3 §4): groups, group_members, feature_grants,
// config_meta. FK kép `(tenant_id, x_id) → x(tenant_id, id)` chặn ở DB thành viên/grant chéo tenant (A14).
// RLS, policy, quyền `config_meta`, trigger `tenants_beta_group` (tạo `beta-testers` cùng mọi INSERT tenant), backfill
// và hàng `config_meta` nằm ở migration custom 0006_permissions_rls (không khai ở đây).
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admin, features, tenants, users } from "./admin";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

export const groups = admin.table(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: jsonb("name").notNull(),
    description: text("description"),
    version: integer("version").notNull().default(1),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("groups_tenant_key_uq").on(t.tenantId, t.key),
    unique("groups_tenant_id_uq").on(t.tenantId, t.id),
    check("groups_key_check", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("groups_name_check", sql`jsonb_typeof(${t.name}) = 'object' AND ${t.name} ? 'vi'`),
    check("groups_description_check", sql`char_length(${t.description}) <= 400`),
    check("groups_version_check", sql`${t.version} >= 1`),
  ],
);

export const groupMembers = admin.table(
  "group_members",
  {
    tenantId: uuid("tenant_id").notNull(),
    groupId: uuid("group_id").notNull(),
    userId: uuid("user_id").notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: tsz("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "group_members_pkey", columns: [t.groupId, t.userId] }),
    index("group_members_user_idx").on(t.userId),
    foreignKey({
      name: "group_members_group_fk",
      columns: [t.tenantId, t.groupId],
      foreignColumns: [groups.tenantId, groups.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "group_members_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
  ],
);

export const featureGrants = admin.table(
  "feature_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    groupId: uuid("group_id"),
    userId: uuid("user_id"),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: tsz("granted_at").notNull().defaultNow(),
  },
  (t) => [
    index("feature_grants_tenant_feature_idx").on(t.tenantId, t.featureId),
    uniqueIndex("feature_grants_group_uq")
      .on(t.tenantId, t.featureId, t.groupId)
      .where(sql`${t.groupId} IS NOT NULL`),
    uniqueIndex("feature_grants_user_uq")
      .on(t.tenantId, t.featureId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index("feature_grants_group_idx").on(t.groupId),
    index("feature_grants_user_idx").on(t.userId),
    foreignKey({
      name: "feature_grants_group_fk",
      columns: [t.tenantId, t.groupId],
      foreignColumns: [groups.tenantId, groups.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "feature_grants_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
    check("feature_grants_subject_check", sql`num_nonnulls(${t.groupId}, ${t.userId}) = 1`),
  ],
);

/** Một hàng (`id = 1`); `config_version` +1 mỗi transaction ghi cấu hình (M3-R15), khoá CUỐI của transaction. */
export const configMeta = admin.table(
  "config_meta",
  {
    id: smallint("id").primaryKey().default(1),
    configVersion: integer("config_version").notNull().default(0),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("config_meta_id_check", sql`${t.id} = 1`),
    check("config_meta_config_version_check", sql`${t.configVersion} >= 0`),
  ],
);
