import { describe, expect, it } from "bun:test";
import { ErrorResponseSchema, HealthResponseSchema } from "@ai/contracts";
import pkg from "../../../apps/admin-api/package.json";
import { createApp } from "../../../apps/admin-api/src/app";

const ORIGIN = "http://localhost:3000";
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
const app = createApp({ version: pkg.version, corsOrigins: [ORIGIN] });

describe("ADM-NFR-06 · M0-AC08 · GET /health", () => {
  it("ADM-NFR-06 · M0-AC08 · version của admin-api là 0.0.0 ở M0", () => {
    expect(pkg.version).toBe("0.0.0");
  });

  it("ADM-NFR-06 · M0-AC08 · 200 và body đúng {status:ok, version:0.0.0}", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: "0.0.0" });
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
  });

  it("ADM-NFR-06 · M0-AC08 · luôn có X-Request-Id hợp lệ khi request không gửi", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-request-id") ?? "").toMatch(REQUEST_ID);
  });

  it("ADM-NFR-06 · M0-AC08 · X-Request-Id hợp lệ được giữ nguyên", async () => {
    const res = await app.request("/health", { headers: { "X-Request-Id": "req-2026.10_01-A" } });
    expect(res.headers.get("x-request-id")).toBe("req-2026.10_01-A");
  });

  it("ADM-NFR-06 · M0-AC08 · X-Request-Id sai định dạng bị thay bằng id mới hợp lệ", async () => {
    for (const bad of ["co dau cach", "x".repeat(129), "<script>"]) {
      const res = await app.request("/health", { headers: { "X-Request-Id": bad } });
      const got = res.headers.get("x-request-id") ?? "";
      expect(got).not.toBe(bad);
      expect(got).toMatch(REQUEST_ID);
    }
  });

  it("ADM-NFR-06 · M0-AC08 · CORS: origin trong CORS_ORIGINS được cho, kèm credentials", async () => {
    const res = await app.request("/health", { headers: { Origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const exposed = (res.headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase());
    expect(exposed).toContain("x-request-id");
  });

  it("ADM-NFR-06 · M0-AC08 · CORS: origin lạ không được cho", async () => {
    const res = await app.request("/health", { headers: { Origin: "http://evil.example" } });
    const allow = res.headers.get("access-control-allow-origin");
    expect(allow).not.toBe("http://evil.example");
    expect(allow).not.toBe("*");
  });

  it("ADM-NFR-06 · M0-AC08 · CORS preflight OPTIONS từ origin hợp lệ thành công", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("ADM-NFR-06 · M0-AC08 · p95 của 200 request tuần tự < 20 ms", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const res = await app.request("/health");
      samples.push(performance.now() - t0);
      expect(res.status).toBe(200);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity).toBeLessThan(20);
  });
});

describe("ADM-NFR-06 · M0-AC09 · lỗi chung", () => {
  it("ADM-NFR-06 · M0-AC09 · đường dẫn không tồn tại → 404 NOT_FOUND", async () => {
    const res = await app.request("/khong-co");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    expect(res.headers.get("x-request-id") ?? "").toMatch(REQUEST_ID);
  });

  it("ADM-NFR-06 · M0-AC09 · lỗi không lường trước → 500 INTERNAL_ERROR, không lộ stack", async () => {
    // version sai định dạng làm HealthResponseSchema.parse ném lỗi trong route (spec §3.1, §9 qc#7)
    const broken = createApp({ version: "khong-phai-semver", corsOrigins: [ORIGIN] });
    const res = await broken.request("/health");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(text).not.toMatch(/\bat \S+ \(|\.ts:\d+|ZodError/);
    expect(res.headers.get("x-request-id") ?? "").toMatch(REQUEST_ID);
  });
});
