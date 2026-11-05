// CR-118 · cr118-auth · cổng xác thực của web gộp (UI/application chỉ biết các kiểu này; adapter admin-api ở `adapters/`).
import type { LoginRequest, LoginResponse } from "@ai/contracts/chat";

export interface AuthPort {
  /** Bước 1: mật khẩu. `authenticated` ⇒ phiên đã nạp; còn lại ⇒ bước đổi mật khẩu / TOTP. */
  login(req: LoginRequest): Promise<LoginResponse>;
  /** Đổi mật khẩu bắt buộc lần đầu bằng `change_token`. */
  changePassword(changeToken: string, newPassword: string): Promise<LoginResponse>;
  /** Bước 2FA: mã 6 số hoặc mã dự phòng. */
  verifyTotp(totpToken: string, code: string): Promise<LoginResponse>;
  logout(): Promise<void>;
}

/** App/module người dùng mở được (`/pack/me.apps` của FeatureGate). `null` = chưa có nguồn ⇒ suy từ `me.kind`. */
export type AppsSource = () => Promise<readonly string[] | null>;
/** Khoá gói trang chủ (`/pack/me.home`); `null` = không có ⇒ home theo quyền. */
export type HomeSource = () => Promise<string | null>;
