// CR-112 · ADM-FR-80, ADM-FR-81, ADM-FR-82 · ADM-BR-15/16: vai theo app (`admin.app_roles`) — vai là nguồn, biên dịch một
// chiều xuống Group (đơn vị thực thi) + feature-grant `<k'>-read|write|admin`. Một vai ↔ một Group, đúng một app, một mức.
import { z } from "zod";
import { UuidSchema } from "./common";
import { GroupNameSchema } from "./groups";
import { PACK_ACTIONS, type PackAction, PackKeySchema, type PackRole } from "./packs";

/** Mức của vai = mã quyền gói (cộng dồn): read ⊂ write ⊂ admin. Nhãn hiển thị "Xem/Sửa/Quản trị" (CR-111). */
export const AppRoleLevelSchema = z.enum(PACK_ACTIONS);
export type AppRoleLevel = z.infer<typeof AppRoleLevelSchema>;

/** Mức → tập việc mà Group của vai được cấp (giống hệt Group vai mặc định cùng mức, `PACK_ROLE_ACTIONS`). */
export const LEVEL_ACTIONS = {
  read: ["read"],
  write: ["read", "write"],
  admin: ["read", "write", "admin"],
} as const satisfies Record<AppRoleLevel, readonly PackAction[]>;

/** Vai mặc định (do bật gói tạo): key vai = vai cũ của Group `<k'>-<vai>`. */
export const DEFAULT_ROLE_LEVEL = {
  viewer: "read",
  editor: "write",
  owner: "admin",
} as const satisfies Record<PackRole, AppRoleLevel>;

/** So mức: read < write < admin. */
export const levelRank = (l: AppRoleLevel): number => PACK_ACTIONS.indexOf(l);

/** Khoá vai trong một app của tenant (Group key = `<k'>-<key>`, ≤ 32 ký tự). */
export const APP_ROLE_KEY_RE = /^[a-z][a-z0-9-]{1,19}$/;
export const AppRoleKeySchema = z.string().trim().toLowerCase().regex(APP_ROLE_KEY_RE);
export const APP_ROLES_MAX = 500;
export const APP_ROLE_MEMBERS_MAX = 500;

export const AppRoleSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  pack: PackKeySchema,
  key: z.string(),
  name: GroupNameSchema,
  level: AppRoleLevelSchema,
  group_id: UuidSchema,
  is_default: z.boolean(),
  member_count: z.number().int().nonnegative(),
  /** Trần công ty của app (mức entitlement cao nhất, CR-111); null = app đang tắt. */
  ceiling: AppRoleLevelSchema.nullable(),
  /** `level ≤ ceiling` — vai vượt trần hiện "không hiệu lực" (BR-12). */
  effective: z.boolean(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AppRole = z.infer<typeof AppRoleSchema>;

/** `GET /admin/app-roles?tenant_id=&pack=` — tenant_admin: chỉ tenant mình (tenant khác ⇒ 404). */
export const AppRoleListQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  pack: PackKeySchema.optional(),
});
export type AppRoleListQuery = z.infer<typeof AppRoleListQuerySchema>;

export const AppRoleListResponseSchema = z.strictObject({
  items: z.array(AppRoleSchema).max(APP_ROLES_MAX),
});
export type AppRoleListResponse = z.infer<typeof AppRoleListResponseSchema>;

/** `POST /admin/app-roles?tenant_id=` — vai tuỳ biến: Group mới + vai + grant theo mức. `key` vắng ⇒ server sinh. */
export const AppRoleCreateRequestSchema = z.strictObject({
  pack: PackKeySchema,
  name: GroupNameSchema,
  level: AppRoleLevelSchema,
  key: AppRoleKeySchema.optional(),
});
export type AppRoleCreateRequest = z.infer<typeof AppRoleCreateRequestSchema>;

/** `PATCH /admin/app-roles/:id` — đổi tên và/hoặc mức (biên dịch lại); `version` sai ⇒ 409 VERSION_CONFLICT. */
export const AppRoleUpdateRequestSchema = z
  .strictObject({
    version: z.number().int().positive(),
    name: GroupNameSchema.optional(),
    level: AppRoleLevelSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.level !== undefined, {
    message: "name hoặc level",
  });
export type AppRoleUpdateRequest = z.infer<typeof AppRoleUpdateRequestSchema>;

/** `POST /admin/app-roles/:id/members` — gán user (nội bộ) vào Group của vai; có đối tác ⇒ 422 cả lô. */
export const AppRoleMembersAddRequestSchema = z.strictObject({
  user_ids: z
    .array(UuidSchema)
    .min(1)
    .max(APP_ROLE_MEMBERS_MAX)
    .transform((xs) => [...new Set(xs)]),
});
export type AppRoleMembersAddRequest = z.infer<typeof AppRoleMembersAddRequestSchema>;

export const AppRoleMembersAddResponseSchema = z.strictObject({
  added: z.array(UuidSchema),
  already: z.array(UuidSchema),
  not_found: z.array(UuidSchema),
});
export type AppRoleMembersAddResponse = z.infer<typeof AppRoleMembersAddResponseSchema>;

/** Mã lỗi riêng của vai (ngoài mã chung). */
export const APP_ROLE_ERRORS = {
  /** Vai mặc định: không xoá, không đổi mức (đổi tên được). */
  DEFAULT_ROLE_PROTECTED: 409,
  /** Xoá vai còn thành viên; `details.member_count`. */
  ROLE_HAS_MEMBERS: 409,
  /** App không phải gói nghiệp vụ đã cài (thiếu `<k'>-read|write|admin`) ⇒ không tạo vai. */
  PACK_NOT_ROLEABLE: 422,
} as const;
export type AppRoleErrorCode = keyof typeof APP_ROLE_ERRORS;
