// PK-FR-10 · TF1 · test cấu hình: proxy dev `/auth` → admin-api, `/pack` → hub-api; cổng; không proxy đường SPA.
import { describe, expect, test } from "bun:test";
import config, { proxy } from "./rsbuild.config";

describe("rsbuild.config (D-18)", () => {
  test("proxy: /auth → admin-api; /pack, /notifications (N3), /conversations + /runs (M2-chat) → hub-api; chỉ hai đích", () => {
    const p = proxy as Record<string, string | { target: string }>;
    const target = (k: string) =>
      typeof p[k] === "string" ? p[k] : (p[k] as { target: string }).target;
    expect(target("/auth")).not.toBe(target("/pack"));
    for (const k of ["/notifications", "/conversations", "/runs"])
      expect(target(k)).toBe(target("/pack"));
    expect(new Set(Object.keys(p).map(target))).toEqual(
      new Set([target("/auth"), target("/pack")]),
    );
  });

  test("/notifications: tải trang (GET text/html) ⇒ index.html; gọi API ⇒ proxy", () => {
    const n = (proxy as Record<string, { bypass: (r: unknown) => string | null }>)[
      "/notifications"
    ];
    expect(n?.bypass({ method: "GET", headers: { accept: "text/html,*/*" } })).toBe("/index.html");
    expect(n?.bypass({ method: "GET", headers: { accept: "application/json" } })).toBeNull();
    expect(n?.bypass({ method: "PUT", headers: { accept: "text/html" } })).toBeNull();
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
