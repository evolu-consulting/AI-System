// CR-102a · ADM-FR-74, ADM-FR-75 · com-c1-ext-identity: user ngoài (đối tác) nằm trong tenant chủ quản, thuộc một
// công ty đối tác (`admin.external_orgs`). Contract `/admin/external-orgs*`. Mã lỗi riêng — KHÔNG thêm vào `API_ERRORS`
// (khoá đếm 46, như `COMMAND_TEST_ERRORS`). Khoá/mở khoá/reset dùng lại `/admin/users/:id/*`.
import { z } from "zod";
import {
  CountSchema,
  DisplayNameSchema,
  EmailSchema,
  IsoDateTime,
  ListQueryBase,
  LocaleSchema,
  pageResponseSchema,
  UsernameSchema,
  UuidSchema,
} from "./common";
import type { USER_KINDS } from "./user-kind";

export { USER_KINDS, type UserKind, UserKindSchema } from "./user-kind";

export const EXTERNAL_ORG_NAME_MAX = 200;
export const ExternalOrgNameSchema = z.string().trim().min(1).max(EXTERNAL_ORG_NAME_MAX);

/** `user_count` = mọi user của công ty; `active_user_count` = user còn đăng nhập được (active, chưa vô hiệu). */
export const ExternalOrgSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  name: ExternalOrgNameSchema,
  active: z.boolean(),
  user_count: CountSchema,
  active_user_count: CountSchema,
  created_at: IsoDateTime,
  /** username người tạo; null khi không thấy (RLS) hoặc đã mất. */
  created_by: z.string().min(1).nullable(),
  updated_at: IsoDateTime,
});
export type ExternalOrg = z.infer<typeof ExternalOrgSchema>;

/** `tenant_id` chỉ có tác dụng với platform_admin (như users). `status` vắng = mọi công ty. */
export const ExternalOrgListQuerySchema = ListQueryBase.extend({
  tenant_id: UuidSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type ExternalOrgListQuery = z.infer<typeof ExternalOrgListQuerySchema>;

export const ExternalOrgListResponseSchema = pageResponseSchema(ExternalOrgSchema);
export type ExternalOrgListResponse = z.infer<typeof ExternalOrgListResponseSchema>;

export const ExternalOrgCreateRequestSchema = z.strictObject({ name: ExternalOrgNameSchema });
export type ExternalOrgCreateRequest = z.infer<typeof ExternalOrgCreateRequestSchema>;

export const ExternalOrgUpdateRequestSchema = z.strictObject({ name: ExternalOrgNameSchema });
export type ExternalOrgUpdateRequest = z.infer<typeof ExternalOrgUpdateRequestSchema>;

/** Role luôn `member` (DB CHECK) — không có trường `role`. Trả `UserCreateResponse` (mật khẩu tạm một lần). */
export const ExternalUserCreateRequestSchema = z.strictObject({
  username: UsernameSchema,
  display_name: DisplayNameSchema,
  email: EmailSchema.nullable().optional(),
  locale: LocaleSchema.default("vi"),
});
export type ExternalUserCreateRequest = z.infer<typeof ExternalUserCreateRequestSchema>;

/** Mã lỗi riêng của user ngoài (HTTP theo giá trị). Dùng kèm `NOT_FOUND`/`FORBIDDEN`/`NAME_TAKEN`/`USERNAME_TAKEN`. */
export const EXTERNAL_ORG_ERRORS = {
  /** User ngoài không được vào Group / không được đổi role khác `member`. */
  EXTERNAL_USER_NOT_ALLOWED: 422,
  /** Công ty đối tác đã vô hiệu: không thêm user, không mở khoá user. */
  EXTERNAL_ORG_INACTIVE: 409,
  /** User đã vô hiệu (không xoá cứng): không mở khoá lại. */
  USER_DEACTIVATED: 409,
} as const satisfies Record<string, 409 | 422>;
export type ExternalOrgErrorCode = keyof typeof EXTERNAL_ORG_ERRORS;
export const EXTERNAL_ORG_ERROR_CODES = Object.keys(EXTERNAL_ORG_ERRORS) as ExternalOrgErrorCode[];

export const ExternalUserNotAllowedDetailsSchema = z.strictObject({
  usernames: z.array(z.string()).optional(),
});

/** Ràng buộc kind/role/org thuần (dùng ở API và test): user ngoài phải có org và role `member`; user nội bộ không có org. */
export function isValidKindShape(u: {
  kind: (typeof USER_KINDS)[number];
  role: string;
  externalOrgId: string | null;
}): boolean {
  if (u.kind === "external") return u.externalOrgId !== null && u.role === "member";
  return u.externalOrgId === null;
}
