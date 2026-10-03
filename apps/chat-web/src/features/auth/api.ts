// CHAT-AC-01, CHAT-AC-04 · gọi `/auth/*` của chat (nơi duy nhất ngoài `~/lib/auth/session`).
import type { LoginRequest, LoginResponse } from "@ai/contracts/chat";
import { session } from "~/lib/auth/session";

/** Đăng nhập; chỉ `authenticated` mới nạp phiên (2 trạng thái còn lại trả nguyên cho LoginPage). */
export function login(req: LoginRequest): Promise<LoginResponse> {
  return session.login(req);
}

/** Đăng xuất: `POST /auth/logout` (lỗi vẫn xoá phiên), báo các tab khác, phát `cleared`. */
export function logout(): Promise<void> {
  return session.logout();
}
