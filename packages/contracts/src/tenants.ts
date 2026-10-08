// ADM-FR-60, ADM-FR-61 · contract /admin/tenants* (spec M1 §3).
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
  MAX_CONCURRENT_SUB_MAX,
  TempPasswordSchema,
  TenantKeySchema,
  TenantNameSchema,
  UpdatedBySchema,
  UsernameSchema,
  UuidSchema,
  VersionSchema,
} from "./common";
import { UserSchema } from "./users";

export const MaxConcurrentSubSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_CONCURRENT_SUB_MAX)
  .nullable();

const tenantShape = {
  id: UuidSchema,
  key: TenantKeySchema,
  name: z.string().min(1),
  active: z.boolean(),
  status: EntityStatusSchema,
  max_concurrent_sub: MaxConcurrentSubSchema,
  user_count: CountSchema,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  version: VersionSchema,
  /** Username người ghi gần nhất; null = seed / không thấy qua RLS (M4-R17). */
  updated_by: UpdatedBySchema,
};
const statusMatchesActive = (t: { active: boolean; status: string }) =>
  (t.status === "locked") === !t.active;
const statusIssue = { message: "status must be 'locked' iff !active", path: ["status"] };

/** `user_count` đếm mọi user của tenant, kể cả đang khoá. */
export const TenantSchema = z.strictObject(tenantShape).refine(statusMatchesActive, statusIssue);
export type Tenant = z.infer<typeof TenantSchema>;

export const TenantStatsSchema = z.strictObject({
  user_count: CountSchema,
  tenant_admin_count: CountSchema,
  locked_user_count: CountSchema,
});
export const TenantDetailSchema = z
  .strictObject({ ...tenantShape, stats: TenantStatsSchema })
  .refine(statusMatchesActive, statusIssue);
export type TenantDetail = z.infer<typeof TenantDetailSchema>;

/** `q` khớp `key`/`name` (ILIKE); sắp `key` tăng dần. */
export const TenantListQuerySchema = ListQueryBase.extend({
  status: EntityStatusSchema.optional(),
});
export type TenantListQuery = z.infer<typeof TenantListQuerySchema>;

export const TenantListResponseSchema = listResponseSchema(TenantSchema);
export type TenantListResponse = z.infer<typeof TenantListResponseSchema>;

export const TenantCreateRequestSchema = z.strictObject({
  key: TenantKeySchema,
  name: TenantNameSchema,
  max_concurrent_sub: MaxConcurrentSubSchema.default(null),
  first_admin: z.strictObject({
    username: UsernameSchema,
    display_name: DisplayNameSchema,
    email: EmailSchema,
    locale: LocaleSchema.default("en"),
  }),
});
export type TenantCreateRequest = z.infer<typeof TenantCreateRequestSchema>;

export const TenantCreateResponseSchema = z.strictObject({
  tenant: TenantSchema,
  first_admin: UserSchema,
  temp_password: TempPasswordSchema,
});
export type TenantCreateResponse = z.infer<typeof TenantCreateResponseSchema>;

/** `key` bất biến (M1-R15): không có trong schema → gửi lên là 400. */
export const TenantUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  name: TenantNameSchema.optional(),
  max_concurrent_sub: MaxConcurrentSubSchema.optional(),
});
export type TenantUpdateRequest = z.infer<typeof TenantUpdateRequestSchema>;
