// ADM-FR-68 · FS4 · test ánh xạ mã lỗi nguồn → khoá i18n tĩnh + đọc refs của SOURCE_IN_USE.
import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/http";
import {
  classifyCredentialError,
  classifySaveError,
  fieldForCode,
  hasCode,
  refsFromDetails,
  sourceErrorKey,
  sourceUsedByCount,
} from "./errors";

const err = (code: string, status = 422, details?: unknown) =>
  new ApiError(status, code as never, "server message KHÔNG được hiển thị", details);

describe("sourceErrorKey", () => {
  test.each([
    "SOURCE_KEY_TAKEN",
    "SOURCE_HOST_NOT_ALLOWED",
    "SOURCE_FORBIDDEN_KIND",
    "SOURCE_UNRESOLVABLE",
    "SOURCE_TOO_LARGE",
    "SOURCE_NOT_FOUND",
    "SOURCE_IN_USE",
  ])("%s → apiError.%s", (code) => {
    expect(sourceErrorKey(err(code))).toBe(`process.sources.apiError.${code}`);
  });
  test("mã lạ / mạng / không phải ApiError ⇒ câu chung", () => {
    expect(sourceErrorKey(err("INTERNAL_ERROR", 500))).toBe("process.sources.apiError.GENERIC");
    expect(sourceErrorKey(new Error("x"))).toBe("process.sources.apiError.GENERIC");
  });
});

describe("helper", () => {
  test("fieldForCode", () => {
    expect(fieldForCode("SOURCE_KEY_TAKEN")).toBe("key");
    expect(fieldForCode("SOURCE_HOST_NOT_ALLOWED")).toBe("url");
    expect(fieldForCode("SOURCE_CREDENTIAL_INVALID")).toBe("credential_secret_id");
    expect(fieldForCode("SOURCE_APPLY_UNSUPPORTED")).toBe("apply_mode");
    expect(fieldForCode("SOURCE_FORBIDDEN_KIND")).toBeNull();
  });
  test("sourceUsedByCount đếm đúng nguồn (type=source)", () => {
    expect(sourceUsedByCount([{ type: "source" }, { type: "provider" }, { type: "source" }])).toBe(
      2,
    );
    expect(sourceUsedByCount(undefined)).toBe(0);
  });
  test("hasCode", () => {
    expect(hasCode(err("SOURCE_IN_USE", 409), "SOURCE_IN_USE")).toBe(true);
    expect(hasCode(new Error("x"), "SOURCE_IN_USE")).toBe(false);
  });
  test("refsFromDetails bỏ phần tử sai dạng", () => {
    expect(
      refsFromDetails({ refs: [{ process_key: "p1", stage_key: "s1" }, { process_key: 1 }, null] }),
    ).toEqual([{ process_key: "p1", stage_key: "s1" }]);
    expect(refsFromDetails(undefined)).toEqual([]);
  });
});

describe("classifySaveError", () => {
  test("SOURCE_KEY_TAKEN → ô key kèm tham số; HOST_NOT_ALLOWED → ô url", () => {
    expect(classifySaveError(err("SOURCE_KEY_TAKEN", 409), "docs")).toEqual({
      type: "field",
      field: "key",
      key: "process.sources.apiError.SOURCE_KEY_TAKEN",
      params: { key: "docs" },
    });
    expect(classifySaveError(err("SOURCE_HOST_NOT_ALLOWED"), "x")).toMatchObject({ field: "url" });
  });
  test("VALIDATION_ERROR theo details.issues → ô config.branch", () => {
    const e = err("VALIDATION_ERROR", 422, { issues: [{ path: ["config", "branch"] }] });
    expect(classifySaveError(e, "x")).toMatchObject({ type: "field", field: "branch" });
  });
  test("FORBIDDEN_KIND / IN_USE → alert; NOT_FOUND → gone; UNAUTHORIZED → ignore", () => {
    expect(classifySaveError(err("SOURCE_FORBIDDEN_KIND", 403), "x")).toEqual({
      type: "alert",
      key: "process.sources.apiError.SOURCE_FORBIDDEN_KIND",
    });
    expect(classifySaveError(err("SOURCE_IN_USE", 409), "x")).toMatchObject({ type: "alert" });
    expect(classifySaveError(err("SOURCE_NOT_FOUND", 404), "x")).toEqual({ type: "gone" });
    expect(classifySaveError(err("UNAUTHORIZED", 401), "x")).toEqual({ type: "ignore" });
  });
  test("SOURCE_CREDENTIAL_INVALID → ô Khoá nguồn; SOURCE_APPLY_UNSUPPORTED → ô Chế độ áp", () => {
    expect(classifySaveError(err("SOURCE_CREDENTIAL_INVALID"), "x")).toMatchObject({
      type: "field",
      field: "credential_secret_id",
      key: "process.sources.apiError.SOURCE_CREDENTIAL_INVALID",
    });
    expect(classifySaveError(err("SOURCE_APPLY_UNSUPPORTED"), "x")).toMatchObject({
      type: "field",
      field: "apply_mode",
      key: "process.sources.apiError.SOURCE_APPLY_UNSUPPORTED",
    });
  });
  test("mạng → câu chung", () => {
    expect(classifySaveError(new Error("x"), "x")).toEqual({
      type: "alert",
      key: "process.sources.apiError.GENERIC",
    });
  });
});

describe("classifyCredentialError", () => {
  test("SECRET_NAME_TAKEN → ô tên; VERSION_CONFLICT → conflict; lạ → alert", () => {
    expect(classifyCredentialError(err("SECRET_NAME_TAKEN", 409))).toEqual({
      type: "field",
      field: "name",
      key: "process.sources.credential.err.taken",
    });
    expect(classifyCredentialError(err("VERSION_CONFLICT", 409))).toEqual({ type: "conflict" });
    expect(classifyCredentialError(err("INTERNAL_ERROR", 500))).toMatchObject({ type: "alert" });
  });
  test("VALIDATION_ERROR theo path → ô", () => {
    expect(
      classifyCredentialError(err("VALIDATION_ERROR", 422, { issues: [{ path: ["name"] }] })),
    ).toMatchObject({ type: "field", field: "name" });
    expect(
      classifyCredentialError(err("VALIDATION_ERROR", 422, { issues: [{ path: ["value"] }] })),
    ).toMatchObject({ type: "field", field: "value" });
  });
});
