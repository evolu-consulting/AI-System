import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { AppError, toErrorBody } from "./lib/errors";
import { redact } from "./lib/logger";

const ORIGIN = "http://localhost:3000";
const cfg = { version: "0.0.0", corsOrigins: [ORIGIN] };

describe("ADM-NFR-06 · createApp lỗi chung", () => {
  test("đường dẫn không tồn tại → 404 NOT_FOUND, có X-Request-Id", async () => {
    const res = await createApp(cfg).request("/khong-co");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":{"code":"NOT_FOUND","message":"Not found"}}');
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("version sai định dạng → /health 500 INTERNAL_ERROR, không lộ stack", async () => {
    const res = await createApp({ ...cfg, version: "x" }).request("/health");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}');
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("AppError giữ status/code; details chỉ có khi truyền", async () => {
    const app = createApp(cfg);
    app.get("/teapot", () => {
      throw new AppError("X_Y", 418, "teapot");
    });
    app.get("/teapot-d", () => {
      throw new AppError("X_Y", 418, "teapot", { a: 1 });
    });
    const r1 = await app.request("/teapot");
    expect(r1.status).toBe(418);
    expect(await r1.text()).toBe('{"error":{"code":"X_Y","message":"teapot"}}');
    const r2 = await app.request("/teapot-d");
    expect(await r2.json()).toEqual({
      error: { code: "X_Y", message: "teapot", details: { a: 1 } },
    });
  });

  test("CORS: origin hợp lệ có credentials + expose X-Request-Id; origin lạ bị từ chối", async () => {
    const app = createApp(cfg);
    const ok = await app.request("/health", { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    expect(ok.headers.get("access-control-expose-headers")).toContain("X-Request-Id");
    const bad = await app.request("/health", { headers: { Origin: "http://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("ADM-NFR-06 · lib", () => {
  test("toErrorBody không thêm key details khi vắng", () => {
    expect(Object.keys(toErrorBody("A_B", "m").error)).toEqual(["code", "message"]);
  });

  test("redact che key nhạy cảm, giữ key khác", () => {
    expect(
      redact({ password: "p", apiKey: "k", Authorization: "a", request_id: "r", count: 1 }),
    ).toEqual({
      password: "[redacted]",
      apiKey: "[redacted]",
      Authorization: "[redacted]",
      request_id: "r",
      count: 1,
    });
  });
});
