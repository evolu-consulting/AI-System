// CR-118 · cr118-auth · `AuthPort` trên admin-api `/auth/*` (proxy cùng origin, `X-App: contracts` do web-kit gắn ⇒ cookie
// `ai_rt_contracts`). Đổi mật khẩu bắt buộc / bước 2FA trả `LoginResponse` như login; chỉ `authenticated` mới nạp phiên.
// Endpoint có sẵn (admin-api `auth.routes.ts`: `/change-password` nhánh change_token, `/totp/verify`) — không thêm endpoint.
import type { LoginResponse } from "@ai/contracts/chat";
import { sendPublic } from "@ai/web-kit/http";
import type { AuthPort } from "../port";
import { session } from "../session";

function apply(res: LoginResponse): LoginResponse {
  if (res.status === "authenticated") session.applyGrant(res);
  return res;
}

export const adminApiAuth: AuthPort = {
  login: (req) => session.login(req),
  async changePassword(changeToken, newPassword) {
    return apply(
      await sendPublic<LoginResponse>("/auth/change-password", {
        method: "POST",
        body: { change_token: changeToken, new_password: newPassword },
      }),
    );
  },
  async verifyTotp(totpToken, code) {
    const c = code.trim();
    const body = /^\d{6}$/.test(c)
      ? { totp_token: totpToken, code: c }
      : { totp_token: totpToken, backup_code: c };
    return apply(await sendPublic<LoginResponse>("/auth/totp/verify", { method: "POST", body }));
  },
  logout: () => session.logout(),
};
