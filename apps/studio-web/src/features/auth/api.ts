// HUB-FR-72 · H4a-R14 · Studio không có endpoint đăng nhập riêng: `POST /auth/login` + `POST /auth/totp/verify` của Admin (Q2, QF2).
import type {
  LoginRequest,
  LoginResponse,
  PasswordChangeRequired,
  TokenGrant,
  TotpVerifyRequest,
} from "@ai/contracts";
import { session } from "#/lib/auth/session";
import { sendPublic } from "#/lib/http";

export type TotpVerifyResponse = TokenGrant | PasswordChangeRequired;

/** Đăng nhập; `authenticated` → lưu phiên trong bộ nhớ. */
export async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await sendPublic<LoginResponse>("/auth/login", { method: "POST", body: req });
  if (res.status === "authenticated") session.applyGrant(res);
  return res;
}

/** Bước 2FA; `authenticated` → lưu phiên. */
export async function verifyTotp(req: TotpVerifyRequest): Promise<TotpVerifyResponse> {
  const res = await sendPublic<TotpVerifyResponse>("/auth/totp/verify", {
    method: "POST",
    body: req,
  });
  if (res.status === "authenticated") session.applyGrant(res);
  return res;
}
