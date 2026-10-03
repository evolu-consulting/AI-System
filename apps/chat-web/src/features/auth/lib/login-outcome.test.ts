// CHAT-AC-01, CHAT-AC-02 · kết quả đăng nhập → câu báo chung / modal khoá / alert Admin Console.
import { describe, expect, test } from "bun:test";
import type { LoginResponse } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";
import { outcomeOfError, outcomeOfResponse } from "./login-outcome";

const res = (status: string) => ({ status }) as unknown as LoginResponse;

describe("outcomeOfResponse", () => {
  test("CHAT-AC-01 · authenticated → ok", () => {
    expect(outcomeOfResponse(res("authenticated"))).toEqual({ kind: "ok" });
  });
  test("CHAT-AC-02 · đổi mật khẩu / 2FA → alert login.useAdmin", () => {
    for (const s of ["password_change_required", "totp_required"]) {
      expect(outcomeOfResponse(res(s))).toEqual({ kind: "alert", key: "login.useAdmin" });
    }
  });
});

describe("outcomeOfError", () => {
  test("CHAT-AC-02 · sai thông tin / dữ liệu sai dạng → một câu chung", () => {
    for (const code of ["INVALID_CREDENTIALS", "VALIDATION_ERROR", "UNAUTHORIZED"] as const) {
      const err = new ApiError(code === "VALIDATION_ERROR" ? 400 : 401, code as never, "x");
      expect(outcomeOfError(err)).toEqual({ kind: "alert", key: "login.invalid" });
    }
  });
  test("CHAT-AC-02 · khoá (vĩnh viễn hoặc tạm) → LockedDialog", () => {
    expect(outcomeOfError(new ApiError(423, "ACCOUNT_LOCKED", "x"))).toEqual({ kind: "locked" });
    expect(outcomeOfError(new ApiError(423, "TEMP_LOCKED", "x"))).toEqual({ kind: "locked" });
  });
  test("CHAT-AC-02 · mất mạng → conn.down; 5xx / lỗi lạ → errors.unknown.title", () => {
    expect(outcomeOfError(new ApiError(0, "NETWORK_ERROR", "x"))).toEqual({
      kind: "alert",
      key: "conn.down",
    });
    expect(outcomeOfError(new ApiError(502, "HTTP_ERROR", "x"))).toEqual({
      kind: "alert",
      key: "errors.unknown.title",
    });
    expect(outcomeOfError(new Error("boom"))).toEqual({
      kind: "alert",
      key: "errors.unknown.title",
    });
  });
});
