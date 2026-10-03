// ADM-FR-01, ADM-FR-03, ADM-FR-06, ADM-FR-08 · gọi API /auth/* (nơi duy nhất ngoài lib/session).
import type {
  BackupCodesResponse,
  Locale,
  LoginRequest,
  LoginResponse,
  Me,
  TokenGrant,
  TotpDisableRequest,
  TotpSetupResponse,
} from "@ai/contracts";
import { session, type TotpVerifyResponse } from "@/lib/auth/session";
import { ApiError, api, sendPublic } from "@/lib/http";

/** Đăng nhập; kết quả đã được nạp vào session (đã đăng nhập hoặc chờ đổi mật khẩu bắt buộc). */
export function login(req: LoginRequest): Promise<LoginResponse> {
  return session.login(req);
}

/** Bước mã 2FA khi đăng nhập (`totp_token` lấy trong bộ nhớ phiên); kết quả nạp vào session như login. */
export function verifyTotpLogin(
  input: { code: string } | { backup_code: string },
): Promise<TotpVerifyResponse> {
  return session.verifyTotp(input);
}

/** Đổi mật khẩu bắt buộc: dùng `change_token` giữ trong bộ nhớ; thành công = đăng nhập luôn. */
export async function changePasswordForced(newPassword: string): Promise<Me> {
  const pending = session.getState().pendingChange;
  if (!pending) throw new ApiError(401, "INVALID_CHANGE_TOKEN", "No change token");
  const grant = await sendPublic<TokenGrant>("/auth/change-password", {
    method: "POST",
    body: { change_token: pending.changeToken, new_password: newPassword },
  });
  session.applyGrant(grant);
  return grant.user;
}

/** Tự đổi mật khẩu (Bearer). 204; các thiết bị khác bị đăng xuất phía server. */
export function changePasswordSelf(currentPassword: string, newPassword: string): Promise<void> {
  return api<void>("/auth/change-password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

/** Đổi ngôn ngữ phiên (`PATCH /auth/me`), trả hồ sơ mới. */
export function patchMyLocale(locale: Locale): Promise<Me> {
  return api<Me>("/auth/me", { method: "PATCH", body: { locale } });
}

/** 2FA bước 0→1: xác thực lại bằng mật khẩu, nhận secret + QR (chỉ giữ trong bộ nhớ, D11). */
export function totpSetup(currentPassword: string): Promise<TotpSetupResponse> {
  return api<TotpSetupResponse>("/auth/totp/setup", {
    method: "POST",
    body: { current_password: currentPassword },
  });
}

/** 2FA bước 2: mã 6 số đúng → bật, trả 10 mã dự phòng (một lần). */
export function totpEnable(code: string): Promise<BackupCodesResponse> {
  return api<BackupCodesResponse>("/auth/totp/enable", { method: "POST", body: { code } });
}

/** Tự tắt 2FA (mật khẩu + mã). 204. */
export function totpDisable(req: TotpDisableRequest): Promise<void> {
  return api<void>("/auth/totp/disable", { method: "POST", body: req });
}

/** Tạo lại mã dự phòng (mã TOTP hiện tại, Q-D1); mã cũ hết hiệu lực. */
export function totpRegenerate(code: string): Promise<BackupCodesResponse> {
  return api<BackupCodesResponse>("/auth/totp/backup-codes", { method: "POST", body: { code } });
}
