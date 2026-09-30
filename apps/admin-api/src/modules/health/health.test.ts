import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";

const app = createApp({ version: "0.0.0", corsOrigins: ["http://localhost:3000"] });
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

describe("ADM-NFR-06 · GET /health", () => {
  test("200, body đúng, có X-Request-Id", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":"ok","version":"0.0.0"}');
    expect(res.headers.get("x-request-id") ?? "").toMatch(ID_RE);
  });

  test("request-id hợp lệ (có dấu chấm, dài 128) được giữ nguyên", async () => {
    for (const id of ["req-2026.10_01-A", "a".repeat(128)]) {
      const res = await app.request("/health", { headers: { "X-Request-Id": id } });
      expect(res.headers.get("x-request-id")).toBe(id);
    }
  });

  test("request-id không hợp lệ bị thay bằng id mới", async () => {
    for (const bad of ["co dau cach", "a".repeat(129), "<x>", "a=b"]) {
      const res = await app.request("/health", { headers: { "X-Request-Id": bad } });
      const got = res.headers.get("x-request-id") ?? "";
      expect(got).not.toBe(bad);
      expect(got).toMatch(ID_RE);
    }
  });

  test("hai request không gửi id nhận hai id khác nhau", async () => {
    const a = (await app.request("/health")).headers.get("x-request-id");
    const b = (await app.request("/health")).headers.get("x-request-id");
    expect(a).not.toBe(b);
  });
});
