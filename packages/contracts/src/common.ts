// ADM-FR-01, ADM-FR-04, ADM-FR-60, ADM-FR-63, ADM-BR-05 · kiểu dùng chung, hằng và bảng mã lỗi M1 (spec M1 §3).
// Không import I/O: file này chạy được ở trình duyệt (admin-web dùng regex/hằng để validate form).
import { z } from "zod";

export const COMPANY_KEY_RE = /^[a-z0-9-]{2,32}$/;
export const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
export const TEMP_PASSWORD_RE = /^[A-Za-z0-9]{16}$/;
export const PASSWORD_MIN_LEN = 10;
export const PASSWORD_MAX_LEN = 128;
export const DISPLAY_NAME_MAX = 64;
export const NAME_MAX = 128;
export const EMAIL_MAX = 254;
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 200;
export const LIST_OFFSET_MAX = 100_000;
export const LIST_Q_MAX = 100;
export const TEMP_PASSWORD_LEN = 16;
export const MAX_CONCURRENT_SUB_MAX = 10_000;

export const ROLES = ["platform_admin", "tenant_admin", "member"] as const;
export const LOCALES = ["vi", "en"] as const;
export const ENTITY_STATUSES = ["active", "locked"] as const;

export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;
export const EntityStatusSchema = z.enum(ENTITY_STATUSES);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

/** ISO 8601 UTC (hậu tố `Z`), không nhận offset khác. */
export const IsoDateTime = z.iso.datetime();
export const UuidSchema = z.uuid();

export const TenantKeySchema = z.string().trim().toLowerCase().regex(COMPANY_KEY_RE);
export const UsernameSchema = z.string().trim().toLowerCase().regex(USERNAME_RE);
// Trim/lowercase trước rồi mới kiểm định dạng email (format check của z.email() chạy trước transform).
export const EmailSchema = z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email());
export const DisplayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX);
export const TenantNameSchema = z.string().trim().min(1).max(NAME_MAX);
/** Mật khẩu không trim: khoảng trắng là ký tự hợp lệ. */
export const NewPasswordSchema = z.string().min(PASSWORD_MIN_LEN).max(PASSWORD_MAX_LEN);
export const VersionSchema = z.number().int().min(1);
export const TempPasswordSchema = z.string().regex(TEMP_PASSWORD_RE);
export const CountSchema = z.number().int().min(0);

export type TenantKey = z.infer<typeof TenantKeySchema>;
export type Username = z.infer<typeof UsernameSchema>;
export type Email = z.infer<typeof EmailSchema>;

/** Query chung của list: `q` trim ≤ 100 (rỗng = bỏ), `limit` 1–200 (50), `offset` 0–100000 (0). */
export const ListQueryBase = z.strictObject({
  q: z
    .string()
    .trim()
    .max(LIST_Q_MAX)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).max(LIST_OFFSET_MAX).default(0),
});

/** `counts` tính theo cùng bộ lọc của list **trừ** `status`. */
export const ListCountsSchema = z.strictObject({
  all: CountSchema,
  active: CountSchema,
  locked: CountSchema,
});
export type ListCounts = z.infer<typeof ListCountsSchema>;

export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), total: CountSchema, counts: ListCountsSchema });
}
export type ListResponse<T> = { items: T[]; total: number; counts: ListCounts };

/** Nguồn duy nhất mã lỗi → HTTP status cho BE/FE/QC (spec M1 §3). */
export const API_ERRORS = {
  VALIDATION_ERROR: 400,
  TENANT_REQUIRED: 400,
  ROLE_NOT_ALLOWED: 400,
  EMAIL_REQUIRED: 400,
  PASSWORD_UNCHANGED: 400,
  INVALID_CURRENT_PASSWORD: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_REFRESH_TOKEN: 401,
  REFRESH_SUPERSEDED: 401,
  INVALID_CHANGE_TOKEN: 401,
  FORBIDDEN: 403,
  ACCOUNT_LOCKED: 403,
  SELF_ACTION_FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  KEY_TAKEN: 409,
  USERNAME_TAKEN: 409,
  EMAIL_TAKEN: 409,
  LAST_ADMIN: 409,
  PLATFORM_TENANT_LOCKED: 409,
  TEMP_LOCKED: 423,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, 400 | 401 | 403 | 404 | 409 | 423 | 500>;

export type ErrorCode = keyof typeof API_ERRORS;
export type ApiErrorStatus = (typeof API_ERRORS)[ErrorCode];
export const ERROR_CODES = Object.keys(API_ERRORS) as ErrorCode[];
export const ErrorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

/** `VALIDATION_ERROR.details`; JSON hỏng → `issues:[{path:[], code:"invalid_json", …}]`. */
export const ValidationErrorDetailsSchema = z.strictObject({
  issues: z.array(
    z.strictObject({
      path: z.array(z.union([z.string(), z.number()])),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetailsSchema>;

export const LastAdminDetailsSchema = z.strictObject({ scope: z.enum(["platform", "tenant"]) });
export type LastAdminDetails = z.infer<typeof LastAdminDetailsSchema>;

export const TempLockedDetailsSchema = z.strictObject({ until: IsoDateTime });
export type TempLockedDetails = z.infer<typeof TempLockedDetailsSchema>;
