// ADM-FR-23 · X1 F4 · lỗi "Chạy thử" → câu plan-frontend-copy.md; key tồn tại ở vi/en.

import { describe, expect, test } from "bun:test";
import { COMMAND_TEST_ERROR_CODES } from "@ai/contracts";
import en from "../../../../packages/i18n/locales/en.json";
import vi from "../../../../packages/i18n/locales/vi.json";
import { describeCommandTestError, validationIssues } from "./errors";
import { ApiError, type ApiErrorCode } from "./http";

const e = (status: number, code: string, details?: unknown) =>
  new ApiError(status, code as ApiErrorCode, "m", details);
const keyOf = (err: unknown) => describeCommandTestError(err, "dich").map((m) => m.key);
const lookup = (o: unknown, k: string): unknown =>
  k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);

describe("X1 F4 · describeCommandTestError", () => {
  test("mã contract + FORBIDDEN/INVALID_REFERENCE/mạng", () => {
    expect(keyOf(e(502, "HUB_UNAVAILABLE"))).toEqual(["commands.test.error.hubUnavailable"]);
    expect(keyOf(e(503, "HUB_NOT_CONFIGURED"))).toEqual(["commands.test.error.hubNotConfigured"]);
    expect(keyOf(e(409, "NOT_CONFIGURED"))).toEqual(["commands.test.error.notConfigured"]);
    expect(keyOf(e(400, "INVALID_REFERENCE"))).toEqual(["commands.test.error.invalidReference"]);
    expect(keyOf(e(403, "FORBIDDEN"))).toEqual(["commands.test.error.forbidden"]);
    expect(keyOf(e(0, "NETWORK_ERROR"))).toEqual(["auth.error.network"]);
  });
  test("5xx thân không phải JSON / mã lạ ⇒ Hub không phản hồi", () => {
    expect(keyOf(e(500, "HTTP_ERROR"))).toEqual(["commands.test.error.hubUnavailable"]);
    expect(keyOf(new Error("x"))).toEqual(["commands.test.error.hubUnavailable"]);
  });
  test("CMD_MISSING_ARG: thiếu + dòng giá trị không hợp lệ", () => {
    const r = describeCommandTestError(
      e(422, "CMD_MISSING_ARG", { missing: ["lang", "text"], invalid: ["lang"] }),
      "dich",
    );
    expect(r).toEqual([
      { key: "commands.test.error.missingArg", params: { name: "dich", missing: "lang, text" } },
      { key: "commands.test.error.invalidArg", params: { invalid: "lang" } },
    ]);
  });
  test("VALIDATION_ERROR: issues → 'path: message', thấy path run_as_user_id", () => {
    const d = { issues: [{ path: ["run_as_user_id"], message: "Invalid UUID" }] };
    expect(describeCommandTestError(e(400, "VALIDATION_ERROR", d), "dich")[0]?.params).toEqual({
      message: "run_as_user_id: Invalid UUID",
    });
    expect(validationIssues(d).paths).toEqual(["run_as_user_id"]);
  });
  test("mọi mã COMMAND_TEST_ERRORS trừ SIDE_EFFECT (hộp xác nhận) có câu riêng; key có ở vi/en", () => {
    for (const c of COMMAND_TEST_ERROR_CODES.filter((x) => x !== "SIDE_EFFECT_CONFIRM_REQUIRED")) {
      for (const k of keyOf(e(400, c, {}))) {
        expect(typeof lookup(vi, k)).toBe("string");
        expect(typeof lookup(en, k)).toBe("string");
      }
    }
  });
  test("bundle không chứa tên biến token Hub (bundle-secret): câu 503 không nhắc tên biến", () => {
    expect(JSON.stringify(vi)).not.toContain("HUB_INTERNAL_TOKEN");
    expect(JSON.stringify(en)).not.toContain("HUB_INTERNAL_TOKEN");
  });
});
