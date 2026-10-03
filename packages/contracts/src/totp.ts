// ADM-FR-08 · M4-R16 · M4-AC11 · contract 2FA TOTP (plan-cd §4.1–4.2): /auth/totp/{setup,enable,disable,backup-codes,verify}.
// Không import `auth.ts` (auth.ts dùng `TotpRequiredSchema` cho nhánh login) — tránh vòng.
import { z } from "zod";
import { PASSWORD_MAX_LEN } from "./common";

export const TOTP_TOKEN_EXPIRES_IN = 300;
export const TOTP_SETUP_EXPIRES_IN = 600;
export const BACKUP_CODE_COUNT = 10;

const JWT_MAX = 4096;
/** Mã TOTP 6 chữ số. */
export const TotpCodeSchema = z.string().regex(/^\d{6}$/);
/** Mã dự phòng `xxxx-xxxx` (gạch nối tuỳ chọn); nhận chữ HOA, chuẩn hoá về chữ thường. */
export const BackupCodeSchema = z
  .string()
  .regex(/^[2-9a-hjkmnp-z]{4}-?[2-9a-hjkmnp-z]{4}$/i)
  .transform((s) => s.toLowerCase());
const CurrentPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LEN);
const TotpTokenSchema = z.string().min(1).max(JWT_MAX);

/** Nhánh thứ ba của `LoginResponseSchema`: mật khẩu đúng, còn bước mã 2FA. */
export const TotpRequiredSchema = z.strictObject({
  status: z.literal("totp_required"),
  totp_token: TotpTokenSchema,
  expires_in: z.literal(TOTP_TOKEN_EXPIRES_IN),
});
export type TotpRequired = z.infer<typeof TotpRequiredSchema>;

/** Đúng một trong `code` / `backup_code` (object strict: gửi cả hai → lỗi). */
export const TotpVerifyRequestSchema = z.union([
  z.strictObject({ totp_token: TotpTokenSchema, code: TotpCodeSchema }),
  z.strictObject({ totp_token: TotpTokenSchema, backup_code: BackupCodeSchema }),
]);
export type TotpVerifyRequest = z.infer<typeof TotpVerifyRequestSchema>;

export const TotpSetupRequestSchema = z.strictObject({ current_password: CurrentPasswordSchema });
export type TotpSetupRequest = z.infer<typeof TotpSetupRequestSchema>;

export const TotpSetupResponseSchema = z.strictObject({
  secret: z.string().regex(/^[A-Z2-7]{32}$/),
  otpauth_url: z.string().startsWith("otpauth://totp/"),
  qr_svg: z.string().startsWith("data:image/svg+xml;base64,"),
  account_label: z.string().min(1),
  expires_in: z.literal(TOTP_SETUP_EXPIRES_IN),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponseSchema>;

export const TotpEnableRequestSchema = z.strictObject({ code: TotpCodeSchema });
export type TotpEnableRequest = z.infer<typeof TotpEnableRequestSchema>;

/** Mã dự phòng thô — chỉ trả một lần (enable, tạo lại). */
export const BackupCodesResponseSchema = z.strictObject({
  backup_codes: z
    .array(z.string().regex(/^[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/))
    .length(BACKUP_CODE_COUNT),
});
export type BackupCodesResponse = z.infer<typeof BackupCodesResponseSchema>;

export const TotpDisableRequestSchema = z.union([
  z.strictObject({ current_password: CurrentPasswordSchema, code: TotpCodeSchema }),
  z.strictObject({ current_password: CurrentPasswordSchema, backup_code: BackupCodeSchema }),
]);
export type TotpDisableRequest = z.infer<typeof TotpDisableRequestSchema>;

/** Tạo lại mã dự phòng: chỉ mã TOTP hiện tại (Q-D1). */
export const TotpBackupCodesRequestSchema = z.strictObject({ code: TotpCodeSchema });
export type TotpBackupCodesRequest = z.infer<typeof TotpBackupCodesRequestSchema>;
