// PK-FR-10 · TF4 · luật thuần của đăng nhập: `next` an toàn, mã công ty biết trước (D-21), kết quả đăng nhập → câu báo.
import { describe, expect, test } from "bun:test";
import { safeNext } from "./next";
import { knownTenant, normalizeLoginId } from "./tenant";

describe("safeNext", () => {
  test("PK-FR-10 · nhận đường nội bộ, giữ query", () => {
    expect(safeNext("/partners")).toBe("/partners");
    expect(safeNext("/contracts/abc?tab=log")).toBe("/contracts/abc?tab=log");
  });
  test("PK-FR-10 · chặn open redirect, ký tự điều khiển, quay lại /login", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/login",
      "/login?next=/x",
      "",
      3,
    ])
      expect(safeNext(bad)).toBeUndefined();
  });
});

describe("knownTenant (Q-F3)", () => {
  test("PK-FR-10 · ?tenant= ưu tiên nhất, rồi env, rồi mã đã nhớ; chuẩn hoá chữ thường", () => {
    expect(knownTenant({ search: " ACME ", env: "beta", remembered: "gamma" })).toBe("acme");
    expect(knownTenant({ env: "Beta", remembered: "gamma" })).toBe("beta");
    expect(knownTenant({ remembered: "gamma" })).toBe("gamma");
  });
  test('PK-FR-10 · không nguồn nào ⇒ "" (hiện ô Mã công ty)', () => {
    expect(knownTenant({})).toBe("");
    expect(knownTenant({ search: "  ", env: undefined, remembered: null })).toBe("");
  });
  test("normalizeLoginId trim + chữ thường", () => {
    expect(normalizeLoginId("  Lan ")).toBe("lan");
  });
});
