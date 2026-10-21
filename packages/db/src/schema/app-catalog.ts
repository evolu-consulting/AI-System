// app-catalog · danh mục ứng dụng web (Admin quản lý): switcher "Ứng dụng" + URL đích SSO lấy từ đây thay vì env build.
// Catalog toàn hệ thống (như `features`/`commands`): không RLS theo tenant; ghi chỉ qua `/admin/apps` (platform_admin),
// đọc qua `GET /me/apps` (lọc theo quyền người gọi). Migration tay 0016 (seed 4 app, `url` rỗng tới khi server điền từ env).
import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { admin, users } from "./admin";

export const appCatalog = admin.table(
  "app_catalog",
  {
    key: text("key").primaryKey(),
    name: jsonb("name").notNull(),
    icon: text("icon").notNull().default("app"),
    url: text("url").notNull().default(""),
    /** `all` mọi user đăng nhập · `admin` tenant_admin + platform_admin · `platform` chỉ platform_admin. */
    audience: text("audience").notNull().default("all"),
    /** Key feature phải hiệu lực với user (entitlement + grant); null = không đòi. */
    requiredFeature: text("required_feature"),
    /** App đích có trang `/sso` nhận mã một lần (false ⇒ chuyển thẳng tới URL). */
    sso: boolean("sso").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("app_catalog_key_check", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("app_catalog_name_check", sql`jsonb_typeof(${t.name}) = 'object' AND ${t.name} ? 'vi'`),
    check("app_catalog_icon_check", sql`${t.icon} ~ '^[a-z0-9-]{1,32}$'`),
    check("app_catalog_url_check", sql`${t.url} = '' OR ${t.url} ~ '^https?://[^\\s]+$'`),
    check("app_catalog_audience_check", sql`${t.audience} IN ('all', 'admin', 'platform')`),
    check(
      "app_catalog_feature_check",
      sql`${t.requiredFeature} IS NULL OR ${t.requiredFeature} ~ '^[a-z0-9-]{2,32}$'`,
    ),
    check("app_catalog_sort_check", sql`${t.sortOrder} BETWEEN 0 AND 10000`),
    check("app_catalog_version_check", sql`${t.version} >= 1`),
  ],
);
