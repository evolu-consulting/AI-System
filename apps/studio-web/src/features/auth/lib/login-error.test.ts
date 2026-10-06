// HUB-FR-72 · H4a-R14 · map lỗi đăng nhập/TOTP → key i18n (plan-frontend-copy "Đăng nhập — map lỗi").
import { describe, expect, test } from "bun:test";
import { loadStudioLocale } from "@ai/i18n/studio-locales";
import { ApiError } from "#/lib/http";
import { classifyTotpError, describeLoginError, formatClock } from "./login-error";

const vi = await loadStudioLocale("vi");
const has = (key: string): boolean =>
  key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], vi) !==
  undefined;

describe("HUB-FR-72 · describeLoginError", () => {
  test.each([
    ["INVALID_CREDENTIALS", "login.err.invalid"],
    ["ACCOUNT_LOCKED", "login.err.locked"],
    ["NETWORK_ERROR", "login.err.network"],
  ])("%s → %s", (code, key) => {
    const spec = describeLoginError(new ApiError(401, code, "x"));
    expect(spec.key).toBe(key);
    expect(has(key)).toBe(true);
  });

  test("TEMP_LOCKED → {time} HH:MM giờ trình duyệt", () => {
    const until = new Date(2026, 9, 6, 9, 5).toISOString();
    expect(describeLoginError(new ApiError(429, "TEMP_LOCKED", "x", { until }))).toEqual({
      key: "login.err.tempLocked",
      params: { time: "09:05" },
    });
    expect(formatClock("không-phải-ngày")).toBe("");
  });

  test("mã khác → login.err.server {code}; HTTP_ERROR / không phải ApiError → UNKNOWN", () => {
    expect(describeLoginError(new ApiError(500, "INTERNAL_ERROR", "x"))).toEqual({
      key: "login.err.server",
      params: { code: "INTERNAL_ERROR" },
    });
    expect(describeLoginError(new ApiError(502, "HTTP_ERROR", "x")).params).toEqual({
      code: "UNKNOWN",
    });
    expect(describeLoginError(new Error("x")).params).toEqual({ code: "UNKNOWN" });
  });
});

describe("HUB-FR-72 · classifyTotpError", () => {
  test("INVALID_TOTP_TOKEN → expired; 401 khác → wrong; còn lại → other", () => {
    expect(classifyTotpError(new ApiError(401, "INVALID_TOTP_TOKEN", "x"))).toEqual({
      kind: "expired",
    });
    expect(classifyTotpError(new ApiError(401, "INVALID_OTP", "x"))).toEqual({ kind: "wrong" });
    expect(classifyTotpError(new ApiError(0, "NETWORK_ERROR", "x"))).toEqual({
      kind: "other",
      spec: { key: "login.err.network" },
    });
    for (const k of [
      "login.totp.wrong",
      "login.totp.expired",
      "session.expired",
      "forbidden.title",
    ])
      expect(has(k)).toBe(true);
  });
});
