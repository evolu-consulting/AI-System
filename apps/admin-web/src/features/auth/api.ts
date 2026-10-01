// ADM-FR-01, ADM-FR-03, ADM-FR-06 · gọi API /auth/* (nơi duy nhất ngoài lib/session).
import type { Locale, LoginRequest, LoginResponse, Me, TokenGrant } from "@ai/contracts";
import { session } from "@/lib/auth/session";
import { ApiError, api, sendPublic } from "@/lib/http";

/** Đăng nhập; kết quả đã được nạp vào session (đã đăng nhập hoặc chờ đổi mật khẩu bắt buộc). */
export function login(req: LoginRequest): Promise<LoginResponse> {
  return session.login(req);
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
