// com-fix-community-login · luật thuần màn Đăng nhập community-web: bước kế, câu báo lỗi, kiểm mật khẩu mới, link SSO.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { loginError, newPasswordError, normalizeLoginId, ssoLoginHref, stepOf } from "./login";

const grant = {
  status: "authenticated",
  access_token: "a",
  token_type: "Bearer",
  expires_in: 900,
} as never;

describe("stepOf", () => {
  it("authenticated ⇒ vào app; đổi mật khẩu / 2FA ⇒ giữ token bước kế", () => {
    expect(stepOf(grant)).toEqual({ kind: "done" });
    expect(
      stepOf({ status: "password_change_required", change_token: "c", expires_in: 300 }),
    ).toEqual({ kind: "change", token: "c" });
    expect(stepOf({ status: "totp_required", totp_token: "t", expires_in: 300 } as never)).toEqual({
      kind: "totp",
      token: "t",
    });
  });
});

describe("loginError", () => {
  const e = (status: number, code: string) => new ApiError(status, code as never, "x");
  it("sai thông tin luôn một câu chung; khoá / mạng / 5xx có câu riêng", () => {
    expect(loginError(e(401, "INVALID_CREDENTIALS"))).toBe(
      "Mã công ty, tên đăng nhập hoặc mật khẩu không đúng.",
    );
    expect(loginError(e(403, "ACCOUNT_LOCKED"))).toMatch(/bị khoá/);
    expect(loginError(e(0, "NETWORK_ERROR"))).toMatch(/kết nối/);
    expect(loginError(e(500, "HTTP_ERROR"))).toMatch(/lỗi xảy ra/);
    expect(loginError(new Error("x"))).toMatch(/lỗi xảy ra/);
  });
  it("theo bước: token hết hạn, mật khẩu trùng, mã 2FA sai", () => {
    expect(loginError(e(401, "INVALID_CHANGE_TOKEN"), "change")).toMatch(/hết hạn/);
    expect(loginError(e(400, "PASSWORD_UNCHANGED"), "change")).toMatch(/khác mật khẩu tạm/);
    expect(loginError(e(400, "VALIDATION_ERROR"), "change")).toMatch(/chưa đạt yêu cầu/);
    expect(loginError(e(401, "INVALID_CREDENTIALS"), "totp")).toBe("Mã xác thực không đúng.");
  });
});

describe("newPasswordError / normalizeLoginId", () => {
  it("≥ 10 ký tự và hai ô khớp", () => {
    expect(newPasswordError("ngan", "ngan")).toMatch(/10/);
    expect(newPasswordError("Mat-khau-dai-1", "Mat-khau-dai-2")).toBe("Hai mật khẩu không khớp.");
    expect(newPasswordError("Mat-khau-dai-1", "Mat-khau-dai-1")).toBeNull();
  });
  it("trim + chữ thường", () => {
    expect(normalizeLoginId("  Demo ")).toBe("demo");
  });
});

describe("ssoLoginHref", () => {
  it("chỉ mang app + next nội bộ + login=1 (không có URL quay về); chưa cấu hình ⇒ null", () => {
    expect(ssoLoginHref("https://ai.example/", "community")).toBe(
      "https://ai.example/sso?app=community&next=%2F&login=1",
    );
    expect(ssoLoginHref("  ", "community")).toBeNull();
  });
});
