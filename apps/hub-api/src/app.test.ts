// HUB-NFR-04 · khung hub-api: /health (contract chat), 503 khi phụ thuộc lỗi, CORS, request id, lỗi theo CHAT_API_ERRORS.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ErrorResponseSchema, HealthResponseSchema } from "@ai/contracts/chat";
import { createApp } from "./app";
import { appError } from "./lib/errors";
import { setSink } from "./lib/logger";

let restoreSink: () => void = () => {};
beforeAll(() => {
  restoreSink = setSink(() => {});
});
afterAll(() => restoreSink());

const cfg = { version: "0.0.0", corsOrigins: ["http://localhost:3100"] };

describe("hub-api app", () => {
  test("HUB-NFR-04 · GET /health không token → 200 HealthResponseSchema chat", async () => {
    const res = await createApp(cfg).request("/health");
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({
      status: "ok",
      version: "0.0.0",
    });
  });

  test("HUB-NFR-04 · probe lỗi (Redis hỏng) → 503 body lỗi đúng contract", async () => {
    const down = async () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await createApp(cfg, { probes: [async () => {}, down] }).request("/health");
    expect(res.status).toBe(503);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("INTERNAL_ERROR");
  });

  test("HUB-NFR-04 · version sai định dạng → 500, không trả body sai contract", async () => {
    const res = await createApp({ ...cfg, version: "dev" }).request("/health");
    expect(res.status).toBe(500);
  });

  test("HUB-NFR-04 · X-Request-Id hợp lệ được giữ, không hợp lệ thì sinh mới", async () => {
    const app = createApp(cfg);
    const kept = await app.request("/health", { headers: { "X-Request-Id": "abc.1-2_3" } });
    expect(kept.headers.get("X-Request-Id")).toBe("abc.1-2_3");
    const fresh = await app.request("/health", { headers: { "X-Request-Id": "bad id!" } });
    expect(fresh.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("HUB-NFR-04 · CORS chỉ cho origin trong HUB_CORS_ORIGINS", async () => {
    const app = createApp(cfg);
    const ok = await app.request("/health", { headers: { Origin: "http://localhost:3100" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3100");
    const other = await app.request("/health", { headers: { Origin: "http://evil.test" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("hub-api app · lỗi", () => {
  test("CHAT-AC-31 · route lạ → 404 NOT_FOUND; AppError → status theo CHAT_API_ERRORS; lỗi lạ → 500", async () => {
    const app = createApp(cfg);
    app.get("/x/busy", () => {
      throw appError("FLOW_BUSY");
    });
    app.get("/x/boom", () => {
      throw new Error("select secret from t");
    });
    const nf = await app.request("/nope");
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
    const busy = await app.request("/x/busy");
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe("FLOW_BUSY");
    const boom = await app.request("/x/boom");
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
