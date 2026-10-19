// PK-FR-10 · TF1 · test cấu hình: proxy dev `/auth` → admin-api, `/pack` → hub-api; cổng; không proxy đường SPA.
import { describe, expect, test } from "bun:test";
import config, { proxy } from "./rsbuild.config";

describe("rsbuild.config (D-18)", () => {
  test("proxy chỉ /auth và /pack, mỗi cái một đích riêng", () => {
    expect(Object.keys(proxy).sort()).toEqual(["/auth", "/pack"]);
    expect(proxy["/auth"]).not.toBe(proxy["/pack"]);
  });

  test("route SPA (/contracts, /partners…) không bị proxy", () => {
    const keys = Object.keys(config.server?.proxy ?? {});
    for (const spa of ["/contracts", "/partners", "/prices", "/cks", "/settings", "/login"]) {
      expect(keys.some((k) => spa.startsWith(k))).toBe(false);
    }
  });

  test("cổng 3300 cố định (e2e N1 ghi đè bằng --port)", () => {
    expect(config.server?.port).toBe(3300);
    expect(config.server?.strictPort).toBe(true);
  });
});
