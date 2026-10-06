// HUB-FR-72 · H4a-R14 · phiên Studio: token chỉ trong bộ nhớ; tải trang refresh cookie 1 lần; 401 giữa chừng → refresh 1 lần,
// hỏng → `expired`; đăng xuất xoá phiên. (plan-frontend D5)
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenGrant } from "@ai/contracts";
import { api } from "../http";
import { canRefresh, session } from "./session";

type Reply = { status: number; body?: unknown };
const realFetch = globalThis.fetch;
let replies: Reply[] = [];
let calls: { url: string; auth?: string }[] = [];

const grant = (tok: string): TokenGrant =>
  ({
    status: "authenticated",
    access_token: tok,
    token_type: "Bearer",
    expires_in: 900,
    user: { id: "u1", role: "platform_admin" },
  }) as unknown as TokenGrant;
const e401 = (code: string): Reply => ({ status: 401, body: { error: { code, message: "x" } } });

beforeEach(() => {
  session.reset();
  replies = [];
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), auth: h.Authorization });
    const r = replies.shift() ?? { status: 200, body: {} };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("HUB-FR-72 · session", () => {
  test("ensure: cookie hợp lệ → authed, gọi /auth/refresh đúng 1 lần dù gọi đồng thời", async () => {
    replies = [{ status: 200, body: grant("t1") }];
    const [a, b] = await Promise.all([session.ensure(), session.ensure()]);
    expect([a, b]).toEqual(["authed", "authed"]);
    expect(await session.ensure()).toBe("authed");
    expect(calls.map((c) => c.url)).toEqual(["/auth/refresh"]);
    expect(session.getState().accessToken).toBe("t1");
  });

  test("ensure: không có cookie (401) → anon; lỗi mạng cũng anon", async () => {
    replies = [e401("AUTH_EXPIRED")];
    expect(await session.ensure()).toBe("anon");
    session.reset();
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await session.ensure()).toBe("anon");
  });

  test("REFRESH_SUPERSEDED → thử lại 1 lần", async () => {
    replies = [e401("REFRESH_SUPERSEDED"), { status: 200, body: grant("t2") }];
    expect(await session.ensure()).toBe("authed");
    expect(calls).toHaveLength(2);
  });

  test("401 giữa phiên → refresh rồi gửi lại với token mới", async () => {
    session.applyGrant(grant("old"));
    replies = [
      e401("AUTH_EXPIRED"),
      { status: 200, body: grant("new") },
      { status: 200, body: { ok: 1 } },
    ];
    expect(await api<{ ok: number }>("/studio/api/me")).toEqual({ ok: 1 });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer old", undefined, "Bearer new"]);
    expect(session.getState().accessToken).toBe("new");
  });
});

describe("HUB-FR-72 · session · giữa phiên", () => {
  test("refresh hỏng giữa phiên → status expired + sự kiện `expired`, token bị xoá", async () => {
    session.applyGrant(grant("old"));
    let fired = 0;
    session.on("expired", () => fired++);
    replies = [e401("AUTH_EXPIRED"), e401("INVALID_REFRESH_TOKEN")];
    await expect(api("/studio/api/me")).rejects.toMatchObject({ status: 401 });
    expect(fired).toBe(1);
    expect(session.getState()).toMatchObject({ status: "expired", accessToken: null });
    expect(await session.ensure()).toBe("anon");
  });

  test("logout: gọi /auth/logout (lỗi vẫn xoá phiên) + sự kiện `cleared`", async () => {
    session.applyGrant(grant("t"));
    let cleared = 0;
    session.on("cleared", () => cleared++);
    replies = [{ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } }];
    await session.logout();
    expect(calls[0]?.url).toBe("/auth/logout");
    expect(session.getState()).toMatchObject({ status: "anon", accessToken: null, user: null });
    expect(cleared).toBe(1);
  });

  test("D4: AUTH_BASE khác origin → không refresh bằng cookie", () => {
    expect(canRefresh("")).toBe(true);
    expect(canRefresh("https://auth.example.com")).toBe(false);
  });
});
