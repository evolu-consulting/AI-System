// CHAT-AC-01 · `next` sau đăng nhập chỉ nhận đường nội bộ.
import { describe, expect, test } from "bun:test";
import { safeNext } from "./next";

describe("safeNext", () => {
  test("CHAT-AC-01 · nhận đường nội bộ kèm query", () => {
    expect(safeNext("/c/abc?flow=f1")).toBe("/c/abc?flow=f1");
  });
  test("CHAT-AC-01 · từ chối URL ngoài, giao thức tương đối, ký tự điều khiển", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      String.raw`/\evil.com`,
      "/\t/evil.com",
      "c/new",
      "",
    ]) {
      expect(safeNext(bad)).toBeUndefined();
    }
  });
  test("CHAT-AC-01 · không quay lại /login, bỏ giá trị không phải chuỗi", () => {
    expect(safeNext("/login?next=/c/new")).toBeUndefined();
    expect(safeNext(42)).toBeUndefined();
  });
});
