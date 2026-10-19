// PK-FR-10 · TF4 · gọi `/auth/*` của contracts-web (admin-api qua proxy cùng origin, D-18).
import type { LoginRequest, LoginResponse } from "@ai/contracts/chat";
import { session } from "./lib/session";

/** Đăng nhập; chỉ `authenticated` mới nạp phiên. */
export function login(req: LoginRequest): Promise<LoginResponse> {
  return session.login(req);
}

/** Đăng xuất: `POST /auth/logout` (lỗi vẫn xoá phiên), báo các tab khác, phát `cleared`. */
export function logout(): Promise<void> {
  return session.logout();
}
