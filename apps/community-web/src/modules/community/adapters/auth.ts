// com-fix-community-login · `/auth/*` của admin-api (proxy cùng origin, `X-App: community` do web-kit gắn) ⇒ cookie
// `ai_rt_community` (HttpOnly, Path=/auth). Đăng nhập / đổi mật khẩu bắt buộc / bước 2FA đều trả `LoginResponse`; chỉ
// `authenticated` mới nạp phiên.
import type { LoginRequest, LoginResponse } from "@ai/contracts/chat";
import { sendPublic } from "@ai/web-kit/http";
import { session } from "./session";

function apply(res: LoginResponse): LoginResponse {
  if (res.status === "authenticated") session.applyGrant(res);
  return res;
}

export function login(req: LoginRequest): Promise<LoginResponse> {
  return session.login(req);
}

/** Đổi mật khẩu bắt buộc (đối tác lần đầu): `change_token` từ bước login ⇒ phiên mới. */
export async function changePasswordForced(
  changeToken: string,
  newPassword: string,
): Promise<LoginResponse> {
  return apply(
    await sendPublic<LoginResponse>("/auth/change-password", {
      method: "POST",
      body: { change_token: changeToken, new_password: newPassword },
    }),
  );
}

/** Bước 2FA: mã 6 số hoặc mã dự phòng. */
export async function verifyTotp(totpToken: string, code: string): Promise<LoginResponse> {
  const c = code.trim();
  const body = /^\d{6}$/.test(c)
    ? { totp_token: totpToken, code: c }
    : { totp_token: totpToken, backup_code: c };
  return apply(await sendPublic<LoginResponse>("/auth/totp/verify", { method: "POST", body }));
}

export function logout(): Promise<void> {
  return session.logout();
}
