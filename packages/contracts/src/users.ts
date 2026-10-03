// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-BR-05, ADM-BR-09 · contract /admin/users* (spec M1 §3).
// ADM-FR-62 · M3-R13: `groups` (≤ 50, beta đầu rồi key) + `group_count` ở mọi response user; `?group=` (spec M3 §3).
import { z } from "zod";
import {
  CountSchema,
  DisplayNameSchema,
  EmailSchema,
  EntityStatusSchema,
  IsoDateTime,
  ListQueryBase,
  LocaleSchema,
  listResponseSchema,
  RoleSchema,
  TempPasswordSchema,
  TenantKeySchema,
  UpdatedBySchema,
  UsernameSchema,
  UuidSchema,
  VersionSchema,
} from "./common";
import { GroupRefSchema, USER_GROUPS_MAX } from "./groups";

/** `status = "locked"` ⇔ `!active || locked_by_tenant`; `locked_until` = khoá tạm FR-07. */
export const UserSchema = z
  .strictObject({
    id: UuidSchema,
    tenant_id: UuidSchema,
    tenant_key: TenantKeySchema,
    username: UsernameSchema,
    display_name: z.string().min(1),
    email: EmailSchema.nullable(),
    role: RoleSchema,
    locale: LocaleSchema,
    status: EntityStatusSchema,
    active: z.boolean(),
    locked_by_tenant: z.boolean(),
    locked_until: IsoDateTime.nullable(),
    must_change_password: z.boolean(),
    last_login_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
    version: VersionSchema,
    updated_by: UpdatedBySchema,
    groups: z.array(GroupRefSchema).max(USER_GROUPS_MAX),
    group_count: CountSchema,
  })
  .refine((u) => (u.status === "locked") === (!u.active || u.locked_by_tenant), {
    message: "status must be 'locked' iff !active || locked_by_tenant",
    path: ["status"],
  });
export type User = z.infer<typeof UserSchema>;

/** `tenant_id` chỉ có tác dụng với platform_admin; `login=never` = chưa từng đăng nhập. */
export const UserListQuerySchema = ListQueryBase.extend({
  tenant_id: UuidSchema.optional(),
  role: RoleSchema.optional(),
  status: EntityStatusSchema.optional(),
  login: z.literal("never").optional(),
  /** Chỉ lọc hàng (không lọc `counts`); group không thấy được → rỗng. */
  group: UuidSchema.optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserListResponseSchema = listResponseSchema(UserSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const UserCreateRequestSchema = z.strictObject({
  username: UsernameSchema,
  display_name: DisplayNameSchema,
  email: EmailSchema.nullable().optional(),
  role: RoleSchema,
  locale: LocaleSchema.default("vi"),
});
export type UserCreateRequest = z.infer<typeof UserCreateRequestSchema>;

export const UserCreateResponseSchema = z.strictObject({
  user: UserSchema,
  temp_password: TempPasswordSchema,
});
export type UserCreateResponse = z.infer<typeof UserCreateResponseSchema>;

/** `username` không có trong schema (bất biến, M1-R15) → gửi lên là 400. */
export const UserUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  display_name: DisplayNameSchema.optional(),
  email: EmailSchema.nullable().optional(),
  role: RoleSchema.optional(),
  locale: LocaleSchema.optional(),
});
export type UserUpdateRequest = z.infer<typeof UserUpdateRequestSchema>;

export const TempPasswordResponseSchema = z.strictObject({ temp_password: TempPasswordSchema });
export type TempPasswordResponse = z.infer<typeof TempPasswordResponseSchema>;
