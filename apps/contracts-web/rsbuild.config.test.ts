// PK-FR-10 · TF1 · test cấu hình: proxy dev `/auth` → admin-api, `/pack` → hub-api; cổng; không proxy đường SPA.
import { describe, expect, test } from "bun:test";
import config, { proxy } from "./rsbuild.config";

describe("rsbuild.config (D-18)", () => {
  test("proxy: /auth → admin-api; /pack, /notifications (N3), /conversations + /runs (M2-chat) → hub-api; chỉ hai đích", () => {
    const p = proxy as Record<string, string>;
    expect(p["/auth"]).not.toBe(p["/pack"]);
    for (const k of ["/notifications", "/conversations", "/runs"]) expect(p[k]).toBe(p["/pack"]);
    expect(new Set(Object.values(p))).toEqual(new Set([p["/auth"], p["/pack"]]));
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
