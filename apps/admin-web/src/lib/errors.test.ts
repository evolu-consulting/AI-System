import { describe, expect, test } from "bun:test";
import { API_ERRORS } from "@ai/contracts";
import { describeError, describeInputMapErrors, describeLoginError } from "./errors";
import { ApiError, type ApiErrorCode } from "./http";

const err = (code: ApiErrorCode, details?: unknown) =>
  new ApiError(code === "NETWORK_ERROR" ? 0 : 400, code, `msg-${code}`, details);

describe("ADM-FR-01 · lỗi API → key i18n", () => {
  test("mã đã có key tĩnh", () => {
    expect(describeError(err("INVALID_CREDENTIALS")).key).toBe("auth.error.invalid");
    expect(describeError(err("ACCOUNT_LOCKED")).key).toBe("auth.error.accountLocked");
    expect(describeError(err("NETWORK_ERROR")).key).toBe("auth.error.network");
    expect(describeError(err("KEY_TAKEN")).key).toBe("tenants.error.keyTaken");
    expect(describeError(err("VERSION_CONFLICT")).key).toBe("errors.versionConflict");
    expect(describeError(err("INVALID_CHANGE_TOKEN")).key).toBe("password.error.tokenExpired");
  });

  test("TEMP_LOCKED nhận {time} HH:MM giờ trình duyệt", () => {
    const until = new Date(2026, 9, 1, 14, 45).toISOString();
    const spec = describeError(err("TEMP_LOCKED", { until }));
    expect(spec.key).toBe("auth.error.tempLocked");
    expect(spec.params).toEqual({ time: "14:45" });
  });

  test("LAST_ADMIN theo scope", () => {
    expect(describeError(err("LAST_ADMIN", { scope: "platform" })).key).toBe(
      "users.error.lastPlatformAdmin",
    );
    expect(describeError(err("LAST_ADMIN", { scope: "tenant" })).key).toBe("users.error.lastAdmin");
    expect(describeError(err("LAST_ADMIN")).key).toBe("users.error.lastAdmin");
  });

  test("mã lạ/5xx → toast.saveFailed kèm message; đăng nhập → auth.error.server kèm mã", () => {
    expect(describeError(err("INTERNAL_ERROR"))).toEqual({
      key: "toast.saveFailed",
      params: { reason: "msg-INTERNAL_ERROR" },
    });
    expect(describeLoginError(err("INTERNAL_ERROR"))).toEqual({
      key: "auth.error.server",
      params: { code: "INTERNAL_ERROR" },
    });
    expect(describeLoginError(err("INVALID_CREDENTIALS")).key).toBe("auth.error.invalid");
  });

  test("mọi mã trong contract trả về một key (không ném lỗi)", () => {
    for (const code of Object.keys(API_ERRORS)) {
      expect(describeError(err(code as ApiErrorCode)).key.length).toBeGreaterThan(0);
    }
  });
});

describe("ADM-FR-10 · M2-R28 · mã lỗi M2 → câu hiển thị", () => {
  test("mã tĩnh", () => {
    expect(describeError(err("SECRET_NAME_TAKEN")).key).toBe("secrets.error.nameTaken");
    expect(describeError(err("WORKFLOW_DISABLED")).key).toBe("commands.error.workflowDisabled");
    expect(describeError(err("COMMAND_NEEDS_FEATURE")).key).toBe("commands.error.featureRequired");
    expect(describeError(err("CORE_FEATURE_PROTECTED")).key).toBe("features.error.coreProtected");
    expect(describeError(err("SCHEMA_BREAKS_COMMANDS")).key).toBe("workflows.schemaBreaks");
    expect(describeError(err("FEATURE_HAS_EXCLUSIVE_COMMANDS")).key).toBe(
      "features.delete.blocked",
    );
    expect(describeError(err("INVALID_REFERENCE")).key).toBe("errors.invalidReference");
  });

  test("COMMAND_NAME_TAKEN nhận {name}", () => {
    expect(describeError(err("COMMAND_NAME_TAKEN", { name: "dich" }))).toEqual({
      key: "commands.error.nameTaken",
      params: { name: "dich" },
    });
  });

  test("WORKFLOW_IN_USE theo action", () => {
    expect(describeError(err("WORKFLOW_IN_USE", { action: "disable" })).key).toBe(
      "workflows.blocked.disable",
    );
    expect(describeError(err("WORKFLOW_IN_USE", { action: "delete" })).key).toBe(
      "workflows.delete.blocked",
    );
  });

  test("KEY_TAKEN theo màn", () => {
    expect(describeError(err("KEY_TAKEN"), { keyTaken: "workflows.error.keyTaken" }).key).toBe(
      "workflows.error.keyTaken",
    );
  });

  test("INPUT_MAP_INVALID dựng câu từ details", () => {
    const details = { missing: ["target_lang", "tone"], unknown: [], unknown_args: ["x"] };
    expect(describeInputMapErrors(details)).toEqual([
      { key: "commands.error.mapMissing", params: { names: "target_lang, tone" } },
      { key: "commands.error.mapUnknownArg", params: { names: "x" } },
    ]);
    expect(describeError(err("INPUT_MAP_INVALID", details))).toEqual({
      key: "commands.error.mapMissing",
      params: { names: "target_lang, tone" },
    });
    expect(describeInputMapErrors(undefined)).toEqual([]);
  });
});
