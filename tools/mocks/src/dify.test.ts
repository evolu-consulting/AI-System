import { describe, expect, test } from "bun:test";
import { createDifyMock, firstInvalid } from "./dify";
import { DIFY_UNAUTHORIZED, DIFY_WORKFLOW_RUN_OK } from "./fixtures";

const app = createDifyMock({ timeoutMs: 50 });
const WF = { inputs: { text: "a" }, response_mode: "blocking", user: "u1" };
const post = (path: string, auth: string | undefined, body: string) =>
  app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body,
  });

describe("ADM-NFR-06 · mock Dify firstInvalid", () => {
  test.each([
    [{}, true, "query is required"],
    [{ query: 1 }, true, "query is required"],
    [{ query: "q" }, true, "inputs is required"],
    [{}, false, "inputs is required"],
    [{ inputs: {} }, false, "user is required"],
    [{ inputs: {}, user: 1 }, false, "user is required"],
    [{ inputs: {}, user: "u" }, false, "response_mode is required"],
    [
      { inputs: {}, user: "u", response_mode: "streaming" },
      false,
      "response_mode must be blocking",
    ],
    [{ inputs: {}, user: "u", response_mode: "blocking" }, false, null],
  ])("%j (query=%p) → %p", (body, withQuery, want) => {
    expect(firstInvalid(body, withQuery)).toBe(want);
  });
});

describe("ADM-NFR-06 · mock Dify HTTP", () => {
  test("ok → body cố định; outputs.text chứa inputs", async () => {
    const res = await post("/v1/workflows/run", "Bearer app-mock-ok", JSON.stringify(WF));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DIFY_WORKFLOW_RUN_OK({ text: "a" }));
  });

  test("401 trước validate; body không phải JSON như {}", async () => {
    const r401 = await post("/v1/workflows/run", "Bearer app-mock-401", "{}");
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual(DIFY_UNAUTHORIZED);
    const r400 = await post("/v1/workflows/run", "Bearer app-mock-ok", "khong-phai-json");
    expect(await r400.json()).toEqual({
      code: "invalid_param",
      message: "inputs is required",
      status: 400,
    });
  });

  test("timeout: chờ ≥ timeoutMs rồi mới trả (kể cả 400)", async () => {
    const t0 = performance.now();
    const res = await post("/v1/workflows/run", "Bearer app-mock-timeout", "{}");
    expect(performance.now() - t0).toBeGreaterThanOrEqual(45);
    expect(res.status).toBe(400);
  });

  test("path lạ → 404 NOT_FOUND", async () => {
    const res = await app.request("/v1/x", { headers: { Authorization: "Bearer app-mock-ok" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });
});
