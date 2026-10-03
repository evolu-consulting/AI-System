// CHAT-AC-03 · http: Bearer, 401 bất kỳ mã từ Hub → refresh đúng 1 lần, `/auth/*` không vòng refresh.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  api,
  apiResponse,
  isAuthPath,
  sendPublic,
  setAuthHooks,
  setRequestLanguage,
} from "./http";

type Reply = { status: number; body?: unknown; raw?: string };
type Call = { path: string; headers: Record<string, string>; credentials?: RequestCredentials };
const realFetch = globalThis.fetch;
let replies: Reply[] = [];
let calls: Call[] = [];
let refreshes: (string | null)[] = [];
let token: string | null = "old";
let nextToken: string | null = "new";

const err401 = (code: string) => ({ status: 401, body: { error: { code, message: "x" } } });

function respond(r: Reply): Response {
  const body = r.raw ?? (r.body === undefined ? null : JSON.stringify(r.body));
  return new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } });
}

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
    calls.push({
      path: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      credentials: init?.credentials,
    });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected ${String(input)}`);
    return respond(r);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
  setRequestLanguage(null);
});

describe("CHAT-AC-03 · gắn Bearer + header", () => {
  test("api gắn Bearer, Accept-Language, credentials same-origin, query bỏ giá trị rỗng", async () => {
    setRequestLanguage("en");
    replies = [{ status: 200, body: { ok: 1 } }];
    expect(
      await api<unknown>("/conversations", { query: { q: "", limit: 20, cursor: undefined } }),
    ).toEqual({ ok: 1 });
    expect(calls[0]?.path).toBe("/conversations?limit=20");
    expect(calls[0]?.headers.Authorization).toBe("Bearer old");
    expect(calls[0]?.headers["Accept-Language"]).toBe("en");
    expect(calls[0]?.credentials).toBe("same-origin");
  });

  test("sendPublic không gắn Bearer; 204 → undefined", async () => {
    replies = [{ status: 204 }];
    expect(await sendPublic("/auth/logout", { method: "POST" })).toBeUndefined();
    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });

  test("header của caller ghi đè Accept (SSE)", async () => {
    replies = [{ status: 200, raw: "data: x\n\n" }];
    const res = await apiResponse("/runs/r1/events", { headers: { Accept: "text/event-stream" } });
    expect(await res.text()).toBe("data: x\n\n");
    expect(calls[0]?.headers.Accept).toBe("text/event-stream");
  });
});

describe("CHAT-AC-03 · 401 từ Hub → refresh đúng 1 lần", () => {
  for (const code of ["AUTH_EXPIRED", "UNAUTHORIZED"]) {
    test(`401 ${code} → refresh rồi gửi lại với token mới`, async () => {
      replies = [err401(code), { status: 200, body: { ok: 2 } }];
      expect(await api<unknown>("/conversations")).toEqual({ ok: 2 });
      expect(refreshes).toEqual(["old"]);
      expect(calls.map((c) => c.headers.Authorization)).toEqual(["Bearer old", "Bearer new"]);
    });
  }

  test("401 thân không phải JSON vẫn refresh", async () => {
    replies = [
      { status: 401, raw: "nope" },
      { status: 200, body: 1 },
    ];
    expect(await api<unknown>("/runs/r1")).toBe(1);
    expect(refreshes).toHaveLength(1);
  });

  test("gửi lại vẫn 401 → ném lỗi lần 2, không refresh thêm", async () => {
    replies = [err401("AUTH_EXPIRED"), err401("AUTH_EXPIRED")];
    const e = await api<unknown>("/conversations").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("AUTH_EXPIRED");
    expect(refreshes).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});

describe("CHAT-AC-03 · 401: dừng đúng chỗ", () => {
  test("refresh trả null → ném lỗi 401 gốc, không gửi lại", async () => {
    nextToken = null;
    replies = [err401("AUTH_EXPIRED")];
    const e = (await api<unknown>("/conversations").catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  test("/auth/* 401 không vòng refresh", async () => {
    for (const path of ["/auth/me", "/auth/refresh"]) {
      replies = [err401("UNAUTHORIZED")];
      const e = (await api<unknown>(path).catch((x: unknown) => x)) as ApiError;
      expect(e.code).toBe("UNAUTHORIZED");
    }
    expect(refreshes).toHaveLength(0);
  });

  test("lỗi khác 401 không refresh", async () => {
    replies = [{ status: 409, body: { error: { code: "FLOW_BUSY", message: "busy" } } }];
    const e = (await api<unknown>("/conversations/c/messages", { method: "POST", body: {} }).catch(
      (x: unknown) => x,
    )) as ApiError;
    expect([e.status, e.code]).toEqual([409, "FLOW_BUSY"]);
    expect(refreshes).toHaveLength(0);
  });
});

describe("CHAT-AC-29 · lỗi mạng / proxy", () => {
  test("fetch TypeError → NETWORK_ERROR (status 0)", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const e = (await api<unknown>("/conversations").catch((x: unknown) => x)) as ApiError;
    expect([e.status, e.code]).toEqual([0, "NETWORK_ERROR"]);
  });

  test("AbortError đi thẳng ra ngoài", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    const e = await api<unknown>("/conversations").catch((x: unknown) => x);
    expect((e as DOMException).name).toBe("AbortError");
  });

  test("502 thân HTML → HTTP_ERROR", async () => {
    replies = [{ status: 502, raw: "<html>" }];
    const e = (await api<unknown>("/conversations").catch((x: unknown) => x)) as ApiError;
    expect([e.status, e.code]).toEqual([502, "HTTP_ERROR"]);
  });
});

describe("isAuthPath", () => {
  test("chỉ /auth và /auth/*", () => {
    expect(isAuthPath("/auth/login")).toBe(true);
    expect(isAuthPath("/auth/me?x=1")).toBe(true);
    expect(isAuthPath("/auth")).toBe(true);
    expect(isAuthPath("/authors")).toBe(false);
    expect(isAuthPath("/conversations")).toBe(false);
  });
});
