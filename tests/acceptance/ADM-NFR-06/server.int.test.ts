import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ROOT, waitFor } from "./_helpers";

const PORT = 3091; // không đụng 3001 của dev
const BASE = `http://localhost:${PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "apps/admin-api/src/server.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_ENV: "test",
      CORS_ORIGINS: "http://localhost:3000",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitFor(
    async () => (await fetch(`${BASE}/health`).catch(() => null))?.status === 200,
    "admin-api lắng nghe /health",
  );
});

afterAll(() => {
  proc.kill();
});

describe("ADM-NFR-06 · M0-AC08/09 · admin-api chạy thật", () => {
  it("ADM-NFR-06 · M0-AC08 · GET /health → 200, body đúng từng byte, có X-Request-Id", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":"ok","version":"0.0.0"}');
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("ADM-NFR-06 · M0-AC09 · GET /khong-co → 404 NOT_FOUND", async () => {
    const res = await fetch(`${BASE}/khong-co`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":{"code":"NOT_FOUND","message":"Not found"}}');
  });

  it("ADM-NFR-06 · M0-AC08 · PORT sai → tiến trình thoát ≠ 0, báo tên biến, không lộ giá trị", async () => {
    const bad = Bun.spawn(["bun", "apps/admin-api/src/server.ts"], {
      cwd: ROOT,
      env: { ...process.env, PORT: "abc", APP_ENV: "test", CORS_ORIGINS: "http://localhost:3000" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await bad.exited;
    const out = (await new Response(bad.stdout).text()) + (await new Response(bad.stderr).text());
    expect(code).not.toBe(0);
    expect(out).toContain("PORT");
    expect(out).not.toContain("abc");
  });
});
