// PK-FR-10 · L1b · kết quả đăng nhập app gói → câu báo (key + tham số).
import { describe, expect, test } from "bun:test";
import type { LoginResponse } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { outcomeOfError, outcomeOfResponse } from "./login-outcome";

const res = (status: string) => ({ status }) as unknown as LoginResponse;

describe("PK-FR-10 · outcomeOfResponse", () => {
  test("authenticated → null; đổi mật khẩu / 2FA → useAdmin", () => {
    expect(outcomeOfResponse(res("authenticated"))).toBeNull();
    expect(outcomeOfResponse(res("totp_required"))).toEqual({ key: "contracts.login.useAdmin" });
  });
});

describe("PK-FR-10 · L1b · outcomeOfError", () => {
  test("TEMP_LOCKED có until ⇒ tempLocked {time}; không until ⇒ locked chung", () => {
    const until = new Date(2026, 9, 20, 18, 30).toISOString();
    expect(outcomeOfError(new ApiError(423, "TEMP_LOCKED", "x", { details: { until } }))).toEqual({
      key: "contracts.login.tempLocked",
      params: { time: "18:30" },
    });
    expect(outcomeOfError(new ApiError(423, "TEMP_LOCKED", "x"))).toEqual({
      key: "contracts.login.locked",
    });
    expect(outcomeOfError(new ApiError(403, "ACCOUNT_LOCKED", "x"))).toEqual({
      key: "contracts.login.locked",
    });
  });

  test("RATE_LIMITED ⇒ rateLimited {minutes}; AUTH_UNAVAILABLE ⇒ unavailable (không rơi về lỗi chung)", () => {
    const rl = new ApiError(429, "RATE_LIMITED", "x", { details: { retry_after_s: 540 } });
    expect(outcomeOfError(rl)).toEqual({
      key: "contracts.login.rateLimited",
      params: { minutes: 9 },
    });
    expect(outcomeOfError(new ApiError(503, "AUTH_UNAVAILABLE", "x"))).toEqual({
      key: "contracts.login.unavailable",
    });
  });

  test("sai thông tin → invalid; mạng → network; 5xx/lạ → unknown", () => {
    expect(outcomeOfError(new ApiError(401, "INVALID_CREDENTIALS", "x"))).toEqual({
      key: "contracts.login.invalid",
    });
    expect(outcomeOfError(new ApiError(0, "NETWORK_ERROR", "x"))).toEqual({
      key: "contracts.errors.network",
    });
    expect(outcomeOfError(new ApiError(502, "HTTP_ERROR", "x"))).toEqual({
      key: "contracts.errors.unknown",
    });
    expect(outcomeOfError(new Error("boom"))).toEqual({ key: "contracts.errors.unknown" });
  });
});
