// app-catalog · contract `/admin/apps*` (platform_admin quản lý danh mục app web) và `GET /me/apps` (app người gọi được mở).
// Một nguồn cho switcher của cả 4 web + URL đích SSO (thay env build). Docs: docs/specs/app-catalog/tasks.md.
import { z } from "zod";
import { LocalizedTextSchema } from "./common";

export const APP_KEY_RE = /^[a-z0-9-]{2,32}$/;
export const APP_NAME_MAX = 60;
export const APP_AUDIENCES = ["all", "admin", "platform"] as const;
export type AppAudience = (typeof APP_AUDIENCES)[number];

export const AppKeySchema = z.string().regex(APP_KEY_RE);
const NameSchema = LocalizedTextSchema(APP_NAME_MAX);
const IconSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

/** URL gốc http(s) (cho phép đường dẫn con, vd `/studio`); không user:pass, query, fragment. Bỏ `/` cuối. `""` = chưa đặt (app ẩn). */
export const AppUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((s) => {
    if (s === "") return true;
    try {
      const u = new URL(s);
      return (
        (u.protocol === "http:" || u.protocol === "https:") &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        !/\s/.test(s)
      );
    } catch {
      return false;
    }
  })
  .transform((s) => s.replace(/\/+$/, ""));

const Fields = {
  name: NameSchema,
  icon: IconSchema,
  url: AppUrlSchema,
  audience: z.enum(APP_AUDIENCES),
  required_feature: AppKeySchema.nullable(),
  sso: z.boolean(),
  sort_order: z.number().int().min(0).max(10000),
  enabled: z.boolean(),
};

export const AppCreateRequestSchema = z.strictObject({
  key: AppKeySchema,
  name: Fields.name,
  icon: Fields.icon.default("app"),
  url: Fields.url.default(""),
  audience: Fields.audience.default("all"),
  required_feature: Fields.required_feature.default(null),
  sso: Fields.sso.default(true),
  sort_order: Fields.sort_order.default(100),
  enabled: Fields.enabled.default(true),
});
export type AppCreateRequest = z.infer<typeof AppCreateRequestSchema>;

export const AppUpdateRequestSchema = z
  .strictObject({
    name: Fields.name,
    icon: Fields.icon,
    url: Fields.url,
    audience: Fields.audience,
    required_feature: Fields.required_feature,
    sso: Fields.sso,
    sort_order: Fields.sort_order,
    enabled: Fields.enabled,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0);
export type AppUpdateRequest = z.infer<typeof AppUpdateRequestSchema>;

export type AppCatalogItem = {
  key: string;
  name: { vi: string; en?: string };
  icon: string;
  url: string;
  audience: AppAudience;
  required_feature: string | null;
  sso: boolean;
  sort_order: number;
  enabled: boolean;
  version: number;
  updated_at: string;
};
export type AppCatalogListResponse = { items: AppCatalogItem[] };

/** `GET /me/apps` (bản gốc) và `GET /auth/me/apps` (cùng handler; web gọi đường này vì mọi web đã proxy `/auth`). */
export const MY_APPS_PATH = "/auth/me/apps";

/** Một app người gọi được mở (đã lọc quyền + bỏ app tắt/chưa có URL). */
export const MeAppSchema = z.strictObject({
  key: z.string(),
  name: z.strictObject({ vi: z.string(), en: z.string().optional() }),
  icon: z.string(),
  url: z.string(),
  sso: z.boolean(),
});
export type MeApp = z.infer<typeof MeAppSchema>;
export const MyAppsResponseSchema = z.strictObject({ items: z.array(MeAppSchema) });
export type MyAppsResponse = z.infer<typeof MyAppsResponseSchema>;
