// CR-118 · cr118-auth · lỗi từng bước login gộp → khoá i18n (gộp luật contracts-web L1b + community-web đổi mật khẩu/TOTP).
import { describe, expect, test } from "bun:test";
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts/common";
import { ApiError } from "@ai/web-kit/http";
import { errorOf, newPasswordError } from "./login-errors";

const e = (status: number, code: string, details?: unknown) =>
  new ApiError(
    status,
    code as ConstructorParameters<typeof ApiError>[1],
    "x",
    details === undefined ? undefined : { details },
  );

describe("CR-118 · errorOf — bước mật khẩu (giữ L1b)", () => {
  test("TEMP_LOCKED có until ⇒ tempLocked {time}; không until / ACCOUNT_LOCKED ⇒ locked", () => {
    const until = new Date(2026, 9, 20, 18, 30).toISOString();
    expect(errorOf(e(423, "TEMP_LOCKED", { until }), "login")).toEqual({
      key: "contracts.login.tempLocked",
      params: { time: "18:30" },
    });
    expect(errorOf(e(423, "TEMP_LOCKED"), "login")).toEqual({ key: "contracts.login.locked" });
    expect(errorOf(e(403, "ACCOUNT_LOCKED"), "login")).toEqual({ key: "contracts.login.locked" });
  });
  test("RATE_LIMITED ⇒ rateLimited {minutes}; AUTH_UNAVAILABLE ⇒ unavailable", () => {
    expect(errorOf(e(429, "RATE_LIMITED", { retry_after_s: 540 }), "login")).toEqual({
      key: "contracts.login.rateLimited",
      params: { minutes: 9 },
    });
    expect(errorOf(e(503, "AUTH_UNAVAILABLE"), "totp")).toEqual({
      key: "contracts.login.unavailable",
    });
  });
  test("sai thông tin ⇒ invalid; mạng ⇒ network; 5xx/lạ ⇒ unknown", () => {
    expect(errorOf(e(401, "INVALID_CREDENTIALS"), "login")).toEqual({
      key: "contracts.login.invalid",
    });
    expect(errorOf(e(0, "NETWORK_ERROR"), "change")).toEqual({ key: "contracts.errors.network" });
    expect(errorOf(e(502, "HTTP_ERROR"), "login")).toEqual({ key: "contracts.errors.unknown" });
    expect(errorOf(new Error("boom"), "login")).toEqual({ key: "contracts.errors.unknown" });
  });
});

describe("CR-118 · errorOf — bước đổi mật khẩu / TOTP", () => {
  test("token bước hết hạn ⇒ expired (về form mật khẩu)", () => {
    expect(errorOf(e(401, "INVALID_CHANGE_TOKEN"), "change")).toEqual({
      key: "contracts.login.expired",
    });
    expect(errorOf(e(401, "INVALID_TOTP_TOKEN"), "totp")).toEqual({
      key: "contracts.login.expired",
    });
  });
  test("đổi mật khẩu: trùng mật khẩu tạm ⇒ passwordUnchanged; còn lại ⇒ passwordWeak {min,max}", () => {
    expect(errorOf(e(400, "PASSWORD_UNCHANGED"), "change")).toEqual({
      key: "contracts.login.passwordUnchanged",
    });
    expect(errorOf(e(400, "VALIDATION_ERROR"), "change")).toEqual({
      key: "contracts.login.passwordWeak",
      params: { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN },
    });
  });
  test("TOTP sai ⇒ totpWrong", () => {
    expect(errorOf(e(401, "INVALID_OTP"), "totp")).toEqual({ key: "contracts.login.totpWrong" });
  });
});

describe("CR-118 · newPasswordError (kiểm ở trình duyệt, server kiểm lại)", () => {
  test("độ dài + khớp", () => {
    const ok = "a".repeat(PASSWORD_MIN_LEN);
    expect(newPasswordError(ok, ok)).toBeNull();
    expect(newPasswordError("a", "a")?.key).toBe("contracts.login.passwordLen");
    expect(newPasswordError(ok, `${ok}x`)?.key).toBe("contracts.login.passwordMismatch");
  });
});
