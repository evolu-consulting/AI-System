import { describe, expect, test } from "bun:test";
import { BASE_ERROR_CODES, ErrorResponseSchema, HealthResponseSchema } from "./index";

describe("ADM-NFR-06 · HealthResponseSchema", () => {
  test("nhận version semver và semver có hậu tố pre-release", () => {
    expect(HealthResponseSchema.parse({ status: "ok", version: "0.0.0" })).toEqual({
      status: "ok",
      version: "0.0.0",
    });
    expect(HealthResponseSchema.safeParse({ status: "ok", version: "1.2.3-rc.1" }).success).toBe(
      true,
    );
  });

  test.each([
    ["version thiếu patch", { status: "ok", version: "1.0" }],
    ["version không phải số", { status: "ok", version: "x" }],
    ["status khác ok", { status: "down", version: "0.0.0" }],
    ["thừa trường", { status: "ok", version: "0.0.0", uptime: 1 }],
    ["thiếu version", { status: "ok" }],
  ])("từ chối: %s", (_name, input) => {
    expect(HealthResponseSchema.safeParse(input).success).toBe(false);
  });
});

describe("ADM-NFR-06 · ErrorResponseSchema", () => {
  test("nhận lỗi không có details và có details", () => {
    const base = { error: { code: "NOT_FOUND", message: "Not found" } };
    expect(ErrorResponseSchema.parse(base)).toEqual(base);
    const withDetails = { error: { code: "X_Y", message: "m", details: { field: "a" } } };
    expect(ErrorResponseSchema.parse(withDetails)).toEqual(withDetails);
  });

  test.each([
    ["code chữ thường", { error: { code: "not_found", message: "m" } }],
    ["code 1 ký tự", { error: { code: "X", message: "m" } }],
    ["code dài 65 ký tự", { error: { code: `A${"B".repeat(64)}`, message: "m" } }],
    ["message rỗng", { error: { code: "NOT_FOUND", message: "" } }],
    ["message 501 ký tự", { error: { code: "NOT_FOUND", message: "a".repeat(501) } }],
    ["thừa trường trong error", { error: { code: "NOT_FOUND", message: "m", stack: "s" } }],
    ["thừa trường ngoài error", { error: { code: "NOT_FOUND", message: "m" }, ok: false }],
  ])("từ chối: %s", (_name, input) => {
    expect(ErrorResponseSchema.safeParse(input).success).toBe(false);
  });

  test("mã lỗi M0 hợp lệ theo schema", () => {
    for (const code of BASE_ERROR_CODES) {
      expect(ErrorResponseSchema.safeParse({ error: { code, message: "m" } }).success).toBe(true);
    }
  });
});
