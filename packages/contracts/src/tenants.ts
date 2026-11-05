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

/** ADM-FR-72 · TZ-R01 · múi giờ tenant mặc định (= DEFAULT cột `admin.tenants.timezone`, migration 0011). */
export const TENANT_TZ_DEFAULT = "Asia/Ho_Chi_Minh";

let tzSet: ReadonlySet<string> | null = null;

/**
 * #227: tên IANA hiện hành mà một số runtime (Chromium/Node ICU cũ) chỉ liệt kê dưới tên cũ trong
 * `Intl.supportedValuesOf("timeZone")` (vd `Asia/Saigon`), dù vẫn nhận tên hiện hành trong `Intl.DateTimeFormat`.
 * Chỉ các tên hiện hành này được chấp nhận thêm; tên cũ (alias) vẫn chỉ hợp lệ khi runtime tự liệt kê (TZ-R02).
 */
const MODERN_IANA_NAMES: ReadonlySet<string> = new Set([
  "Asia/Ho_Chi_Minh",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Yangon",
  "Europe/Kyiv",
  "America/Nuuk",
  "Atlantic/Faroe",
  "Pacific/Kanton",
]);

function knownToIntl(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Phần thuần của TZ-R02 (test được): `listed` = danh sách runtime, `known` = runtime nhận tên này. */
export function isSupportedTimeZoneIn(
  tz: string,
  listed: ReadonlySet<string>,
  known: (tz: string) => boolean,
): boolean {
  return listed.has(tz) || (MODERN_IANA_NAMES.has(tz) && known(tz));
}

/**
 * TZ-R02: tên IANA có trong `Intl.supportedValuesOf("timeZone")`, hoặc là tên hiện hành mà runtime chỉ liệt kê dưới
 * tên cũ (#227: `Asia/Ho_Chi_Minh` trên Chromium/Node chỉ có `Asia/Saigon`). Alias cũ không được runtime liệt kê
 * (như `Asia/Saigon` trên Bun) ⇒ false; phân biệt hoa/thường. Lưu đúng tên người dùng chọn.
 */
export function isSupportedTimeZone(tz: string): boolean {
  tzSet ??= new Set(Intl.supportedValuesOf("timeZone"));
  return isSupportedTimeZoneIn(tz, tzSet, knownToIntl);
}
/** Response: chỉ kiểm độ dài (= CHECK DB 1…64). `abort` ⇒ input sai độ dài chỉ ra một issue (không thêm `custom`). */
export const TimezoneSchema = z.string().min(1, { abort: true }).max(64, { abort: true });
/** Request (create/PATCH tenant, import): thêm kiểm danh sách IANA. Sai ⇒ 400 `VALIDATION_ERROR` path `timezone`. */
export const TimezoneInputSchema = TimezoneSchema.refine(
  isSupportedTimeZone,
  "unsupported time zone",
);

/** N2-FR-04 · trần run quy trình đồng thời của tenant (= CHECK/DEFAULT cột `admin.tenants.process_runs_max`, admin 0013). */
export const TENANT_PROCESS_RUNS_MAX = { min: 1, max: 1000, default: 5 } as const;
export const ProcessRunsMaxSchema = z
  .number()
  .int()
  .min(TENANT_PROCESS_RUNS_MAX.min)
  .max(TENANT_PROCESS_RUNS_MAX.max);

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
  /** ADM-FR-72: tên IANA (TZ-R01). */
  timezone: TimezoneSchema,
  /** N2-FR-04 · server luôn trả; optional để bản ghi/fixture cũ vẫn hợp lệ. */
  process_runs_max: ProcessRunsMaxSchema.optional(),
};
const statusMatchesActive = (t: { active: boolean; status: string }) =>
  (t.status === "locked") === !t.active;
const statusIssue = { message: "status must be 'locked' iff !active", path: ["status"] };

/** `user_count` đếm mọi user của tenant, kể cả đang khoá. */
export const TenantSchema = z.strictObject(tenantShape).refine(statusMatchesActive, statusIssue);
export type Tenant = z.infer<typeof TenantSchema>;

/** niti-onboard (admin 0015): hồ sơ công ty, chỉ đọc ở admin-web; ghi bằng công cụ onboarding (deploy/tenants/*.yaml). */
export const TenantProfileSchema = z.strictObject({
  legal_name: z.string().min(1).max(256).optional(),
  address: z.string().min(1).max(512).optional(),
  /** MST 10 số, chi nhánh `-xxx`. */
  tax_id: z
    .string()
    .regex(/^\d{10}(-\d{3})?$/)
    .optional(),
  email: EmailSchema.optional(),
  websites: z.array(z.url().max(256)).max(10).optional(),
  zalo_oa: z.string().min(1).max(128).optional(),
  phones: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(64),
        number: z.string().regex(/^[0-9 .+()-]{6,24}$/),
      }),
    )
    .max(10)
    .optional(),
});
export type TenantProfile = z.infer<typeof TenantProfileSchema>;

export const TenantStatsSchema = z.strictObject({
  user_count: CountSchema,
  tenant_admin_count: CountSchema,
  locked_user_count: CountSchema,
});
export const TenantDetailSchema = z
  .strictObject({
    ...tenantShape,
    stats: TenantStatsSchema,
    profile: TenantProfileSchema.optional(),
  })
  .refine(statusMatchesActive, statusIssue);
export type TenantDetail = z.infer<typeof TenantDetailSchema>;

/** CR-121 · mã lỗi hồ sơ công ty (khối riêng như `EXTERNAL_ORG_ERRORS`, không thuộc `API_ERRORS`). */
export const TENANT_PROFILE_ERRORS = {
  /** CEO/Giám đốc phải là thành viên đang hoạt động của chính công ty này. */
  LEADER_NOT_MEMBER: 422,
} as const satisfies Record<string, 422>;
export type TenantProfileErrorCode = keyof typeof TENANT_PROFILE_ERRORS;

export const TENANT_PROFILE_PHONE_RE = /^[0-9 .+()-]{6,24}$/;
export const TENANT_PROFILE_TAX_CODE_RE = /^\d{10}(-\d{3})?$/;
export const TENANT_STAFF_SIZE_MAX = 1_000_000;

/** Chuỗi rỗng/chỉ khoảng trắng ⇒ null (xoá giá trị); còn lại kiểm bằng `inner`. */
const clearable = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), inner.nullable());
const textField = (max: number) => clearable(z.string().trim().min(1).max(max));

/** Một người trong công ty (CEO/Giám đốc/trưởng phòng) — chỉ để hiển thị. */
export const TenantPersonSchema = z.strictObject({
  id: UuidSchema,
  display_name: z.string().min(1),
});
export type TenantPerson = z.infer<typeof TenantPersonSchema>;

export const TenantDepartmentSchema = z.strictObject({
  group_id: UuidSchema,
  /** `groups.name` (jsonb vi/en). */
  name: z.record(z.string(), z.string()),
  member_count: CountSchema,
  head: TenantPersonSchema.nullable(),
});
export type TenantDepartment = z.infer<typeof TenantDepartmentSchema>;

/** `GET/PATCH /admin/tenants/:id/profile` — hồ sơ công ty nhập tay + phòng ban (chỉ đọc). */
export const TenantCompanyProfileSchema = z.strictObject({
  tenant_id: UuidSchema,
  /** Cùng bộ đếm `version` với `PATCH /admin/tenants/:id`. */
  version: VersionSchema,
  legal_name: z.string().nullable(),
  tax_code: z.string().nullable(),
  address: z.string().nullable(),
  staff_size: z.number().int().min(0).nullable(),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  ceo: TenantPersonSchema.nullable(),
  director: TenantPersonSchema.nullable(),
  /** Số thành viên đang hoạt động (cùng nguồn "Thành viên"). */
  member_count: CountSchema,
  departments: z.array(TenantDepartmentSchema),
});
export type TenantCompanyProfile = z.infer<typeof TenantCompanyProfileSchema>;

/** Gửi trường nào sửa trường đó; `null`/chuỗi rỗng = xoá. Không có `name` (tên công ty sửa qua `PATCH /admin/tenants/:id`). */
export const TenantProfileUpdateRequestSchema = z.strictObject({
  version: VersionSchema,
  legal_name: textField(256).optional(),
  tax_code: clearable(z.string().trim().regex(TENANT_PROFILE_TAX_CODE_RE)).optional(),
  address: textField(512).optional(),
  staff_size: clearable(z.number().int().min(0).max(TENANT_STAFF_SIZE_MAX)).optional(),
  contact_name: textField(128).optional(),
  contact_email: clearable(EmailSchema).optional(),
  contact_phone: clearable(z.string().trim().regex(TENANT_PROFILE_PHONE_RE)).optional(),
  ceo_user_id: clearable(UuidSchema).optional(),
  director_user_id: clearable(UuidSchema).optional(),
});
export type TenantProfileUpdateRequest = z.infer<typeof TenantProfileUpdateRequestSchema>;

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
  /** TZ-R03: vắng ⇒ mặc định. */
  timezone: TimezoneInputSchema.default(TENANT_TZ_DEFAULT),
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
  timezone: TimezoneInputSchema.optional(),
  /** N2-FR-04 · chỉ platform_admin (route tenants). */
  process_runs_max: ProcessRunsMaxSchema.optional(),
});
export type TenantUpdateRequest = z.infer<typeof TenantUpdateRequestSchema>;
