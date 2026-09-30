import { describe, expect, test } from "bun:test";
import { HUB_EFFECTIVE_OK, HUB_TEST_RUN_OK, HUB_UNAUTHORIZED } from "./fixtures";
import { createHubMock } from "./hub";

const app = createHubMock({ timeoutMs: 50 });
const U = "00000000-0000-7000-8000-0000000000c1";
const req = (method: string, path: string, auth?: string, body?: string) =>
  app.request(path, {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body,
  });

describe("ADM-NFR-06 · mock Hub", () => {
  test("/health không cần token, không chờ khi token timeout", async () => {
    const t0 = performance.now();
    const res = await req("GET", "/health", "Bearer mock-timeout");
    expect(performance.now() - t0).toBeLessThan(45);
    expect(await res.json()).toEqual({ status: "ok", version: "mock" });
  });

  test("test-run ok → trace: []; command/inputs phải là object", async () => {
    const ok = await req(
      "POST",
      "/internal/test-run",
      "Bearer mock-ok",
      '{"command":{},"inputs":{"a":1}}',
    );
    expect(await ok.json()).toEqual(HUB_TEST_RUN_OK({ a: 1 }));
    const bad = await req(
      "POST",
      "/internal/test-run",
      "Bearer mock-ok",
      '{"command":[],"inputs":{}}',
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: { code: "VALIDATION_FAILED", message: "command không hợp lệ" },
    });
  });

  test("effective grants: uuid hợp lệ → 200, sai → 400; mock-401 → 401", async () => {
    expect(
      await (await req("GET", `/agent-grants/effective/${U}`, "Bearer mock-ok")).json(),
    ).toEqual(HUB_EFFECTIVE_OK);
    expect((await req("GET", "/agent-grants/effective/abc", "Bearer mock-ok")).status).toBe(400);
    const r401 = await req("GET", `/agent-grants/effective/${U}`, "Bearer mock-401");
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual(HUB_UNAUTHORIZED);
  });

  test("method không có → 404 sau kịch bản", async () => {
    expect((await req("DELETE", "/internal/test-run", "Bearer mock-ok")).status).toBe(404);
    expect((await req("DELETE", "/internal/test-run")).status).toBe(401);
  });
});
