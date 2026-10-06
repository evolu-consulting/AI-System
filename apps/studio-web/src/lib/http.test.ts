// HUB-FR-72 · H4a-R14 · http: Bearer, ApiError{status,code}, 401 ngoài `/auth/*` → refresh đúng 1 lần.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  api,
  buildUrl,
  isAuthPath,
  sendPublic,
  setAuthHooks,
  setRequestLanguage,
} from "./http";

type Reply = { status: number; body?: unknown; raw?: string };
type Call = { url: string; headers: Record<string, string> };
const realFetch = globalThis.fetch;
let replies: Reply[] = [];
let calls: Call[] = [];
let refreshes: (string | null)[] = [];
let token: string | null = "old";
let nextToken: string | null = "new";

const err = (status: number, code: string) => ({ status, body: { error: { code, message: "x" } } });

beforeEach(() => {
  replies = [];
  calls = [];
  refreshes = [];
  token = "old";
  nextToken = "new";
  setRequestLanguage(null);
  setAuthHooks({
    getToken: () => token,
    refresh: async (stale) => {
      refreshes.push(stale);
      token = nextToken;
      return nextToken;
    },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const r = replies.shift() ?? { status: 200, body: {} };
    const body = r.raw ?? (r.body === undefined ? null : JSON.stringify(r.body));
    return new Response(body, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
});

describe("HUB-FR-72 · lib/http", () => {
  test("gắn Bearer + Accept-Language; đọc JSON", async () => {
    setRequestLanguage("en");
    replies = [{ status: 200, body: { ok: 1 } }];
    expect(await api<{ ok: number }>("/studio/api/me")).toEqual({ ok: 1 });
    expect(calls[0]?.headers.Authorization).toBe("Bearer old");
    expect(calls[0]?.headers["Accept-Language"]).toBe("en");
  });

  test("401 → refresh 1 lần rồi gửi lại với token mới", async () => {
    replies = [err(401, "AUTH_EXPIRED"), { status: 200, body: { v: 2 } }];
    expect(await api<{ v: number }>("/studio/api/agents")).toEqual({ v: 2 });
    expect(refreshes).toEqual(["old"]);
    expect(calls.map((c) => c.headers.Authorization)).toEqual(["Bearer old", "Bearer new"]);
  });

  test("401 lần 2 → ném lỗi, không refresh thêm", async () => {
    replies = [err(401, "AUTH_EXPIRED"), err(401, "AUTH_EXPIRED")];
    await expect(api("/studio/api/agents")).rejects.toMatchObject({ status: 401 });
    expect(refreshes).toHaveLength(1);
  });

  test("refresh trả null (hết phiên) → ném lỗi 401 gốc", async () => {
    nextToken = null;
    replies = [err(401, "AUTH_EXPIRED")];
    await expect(api("/studio/api/me")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_EXPIRED",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("HUB-FR-72 · lib/http · lỗi", () => {
  test("403 → ApiError{status 403, code FORBIDDEN}, không refresh", async () => {
    replies = [err(403, "FORBIDDEN")];
    const e = await api("/studio/api/me").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(refreshes).toHaveLength(0);
  });

  test("`/auth/*` không vòng refresh; sendPublic không gắn Bearer", async () => {
    replies = [err(401, "INVALID_CREDENTIALS")];
    await expect(sendPublic("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(refreshes).toHaveLength(0);
    expect(isAuthPath("/auth/refresh")).toBe(true);
    expect(isAuthPath("/studio/api/auth")).toBe(false);
  });

  test("thân không JSON (502) → HTTP_ERROR; mất mạng → NETWORK_ERROR status 0", async () => {
    replies = [{ status: 502, raw: "<html>" }];
    await expect(api("/studio/api/me")).rejects.toMatchObject({ status: 502, code: "HTTP_ERROR" });
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(api("/studio/api/me")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  test("204 → undefined; query bỏ giá trị rỗng", async () => {
    replies = [{ status: 204 }];
    expect(await api("/studio/api/x", { method: "DELETE" })).toBeUndefined();
    expect(buildUrl("/studio/api/agents", { q: "a b", runtime: "", enabled: true })).toBe(
      "/studio/api/agents?q=a+b&enabled=true",
    );
  });
});
