// ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-06, ADM-FR-07 · contract /auth/* (spec M1 §3).
import { z } from "zod";
import {
  EmailSchema,
  IsoDateTime,
  LocaleSchema,
  NewPasswordSchema,
  PASSWORD_MAX_LEN,
  RoleSchema,
  TenantKeySchema,
  UsernameSchema,
  UuidSchema,
} from "./common";
import { BACKUP_CODE_COUNT, TotpRequiredSchema } from "./totp";

/** Header chọn kiểu client; chỉ đúng chuỗi `extension` mới nhận/trả refresh token trong body. */
export const X_CLIENT_HEADER = "X-Client";
export const X_CLIENT_EXTENSION = "extension";
/** Cookie refresh token của web (`HttpOnly; SameSite=Strict; Path=/auth`). Request web không báo app ⇒ cookie này. */
export const REFRESH_COOKIE = "ai_rt";
/** CR-053 · mỗi app web gửi `X-App` khi gọi `/auth/*` ⇒ phiên riêng từng app (cookie `ai_rt_<app>`). */
export const X_APP_HEADER = "X-App";
export const WEB_APPS = ["admin", "chat", "studio"] as const;
export type WebApp = (typeof WEB_APPS)[number];
/** Tên cookie refresh của một app; vắng app ⇒ `ai_rt` (client cũ, test, công cụ). */
export const refreshCookieName = (app?: WebApp): string =>
  app ? `${REFRESH_COOKIE}_${app}` : REFRESH_COOKIE;
export const ACCESS_TOKEN_EXPIRES_IN = 900;
export const CHANGE_TOKEN_EXPIRES_IN = 300;

const LOGIN_ID_MAX = 64;
const TOKEN_MAX = 200;
const JWT_MAX = 4096;

// Ô đăng nhập chỉ kiểm độ dài: sai định dạng vẫn phải ra 401 INVALID_CREDENTIALS (M1-R01).
const LoginIdSchema = z.string().trim().toLowerCase().min(1).max(LOGIN_ID_MAX);
const CurrentPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LEN);

export const LoginRequestSchema = z.strictObject({
  tenant_key: LoginIdSchema,
  username: LoginIdSchema,
  password: CurrentPasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Hồ sơ người đang giữ access token; `must_change_password` luôn `false`. 2FA (M4): `backup_codes_left` 0 khi chưa bật. */
export const MeSchema = z.strictObject({
  id: UuidSchema,
  tenant: z.strictObject({ id: UuidSchema, key: TenantKeySchema, name: z.string().min(1) }),
  username: UsernameSchema,
  display_name: z.string().min(1),
  email: EmailSchema.nullable(),
  role: RoleSchema,
  locale: LocaleSchema,
  must_change_password: z.literal(false),
  totp_enabled: z.boolean(),
  totp_enabled_at: IsoDateTime.nullable(),
  backup_codes_left: z.number().int().min(0).max(BACKUP_CODE_COUNT),
});
export type Me = z.infer<typeof MeSchema>;

/** `refresh_token` chỉ có khi `X-Client: extension`; web nhận qua cookie `ai_rt`. */
export const TokenGrantSchema = z.strictObject({
  status: z.literal("authenticated"),
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.literal(ACCESS_TOKEN_EXPIRES_IN),
  user: MeSchema,
  refresh_token: z.string().min(1).max(TOKEN_MAX).optional(),
});
export type TokenGrant = z.infer<typeof TokenGrantSchema>;

export const PasswordChangeRequiredSchema = z.strictObject({
  status: z.literal("password_change_required"),
  change_token: z.string().min(1),
  expires_in: z.literal(CHANGE_TOKEN_EXPIRES_IN),
});
export type PasswordChangeRequired = z.infer<typeof PasswordChangeRequiredSchema>;

export const LoginResponseSchema = z.discriminatedUnion("status", [
  TokenGrantSchema,
  PasswordChangeRequiredSchema,
  TotpRequiredSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** Body refresh của extension; web gửi body rỗng + cookie. */
export const RefreshRequestSchema = z.strictObject({
  refresh_token: z.string().min(1).max(TOKEN_MAX),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = TokenGrantSchema;
export type RefreshResponse = TokenGrant;

/** Logout idempotent: extension có thể gửi `refresh_token`, web gửi body rỗng. */
export const LogoutRequestSchema = z.strictObject({
  refresh_token: z.string().max(TOKEN_MAX).optional(),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const ForcedChangePasswordRequestSchema = z.strictObject({
  change_token: z.string().min(1).max(JWT_MAX),
  new_password: NewPasswordSchema,
});
export const SelfChangePasswordRequestSchema = z.strictObject({
  current_password: CurrentPasswordSchema,
  new_password: NewPasswordSchema,
});
/** Đúng một trong hai dạng: object strict nên gửi cả `change_token` lẫn `current_password` → lỗi. */
export const ChangePasswordRequestSchema = z.union([
  ForcedChangePasswordRequestSchema,
  SelfChangePasswordRequestSchema,
]);
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const MeUpdateRequestSchema = z.strictObject({ locale: LocaleSchema });
export type MeUpdateRequest = z.infer<typeof MeUpdateRequestSchema>;
