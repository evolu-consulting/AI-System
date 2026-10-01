import { describe, expect, test } from "bun:test";
import { safeNext } from "./next";

describe("ADM-FR-01 · safeNext chống open redirect", () => {
  test("nhận đường dẫn nội bộ", () => {
    expect(safeNext("/users?tenant=acme")).toBe("/users?tenant=acme");
    expect(safeNext("/")).toBe("/");
  });

  test("chặn URL tuyệt đối và protocol-relative", () => {
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "users",
    ]) {
      expect(safeNext(bad)).toBeUndefined();
    }
  });

  test("chặn ký tự điều khiển, rỗng, không phải chuỗi", () => {
    expect(safeNext("/\t/evil.com")).toBeUndefined();
    expect(safeNext("/a\nb")).toBeUndefined();
    expect(safeNext("")).toBeUndefined();
    expect(safeNext(undefined)).toBeUndefined();
    expect(safeNext(42)).toBeUndefined();
  });
});
