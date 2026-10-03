// CHAT-AC-01, CHAT-AC-03 · phiên chat: khởi động, 401 Hub → refresh 1 lần, refresh hỏng → xoá phiên, đăng xuất.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Me, TokenGrant } from "@ai/contracts/chat";
import { type ApiError, api } from "../http";
import { session } from "./session";

const me = { username: "binh", tenant: { key: "acme" } } as unknown as Me;

type Reply = { status: number; body?: unknown } | "network";
const realFetch = globalThis.fetch;
let routes: Record<string, Reply[]> = {};
let calls: { path: string; auth?: string }[] = [];

const grant = (token: string): TokenGrant => ({
  status: "authenticated",
  access_token: token,
  token_type: "Bearer",
  expires_in: 900,
  user: me,
});
const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status: number, code: string): Reply => ({
  status,
  body: { error: { code, message: "x" } },
});

beforeEach(() => {
  session.reset();
  routes = {};
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0] ?? "";
    calls.push({ path, auth: (init?.headers as Record<string, string>)?.Authorization });
    const r = routes[path]?.shift();
    if (!r) throw new Error(`unexpected ${path}`);
    if (r === "network") throw new TypeError("Failed to fetch");
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("CHAT-AC-01 · khởi động + đăng nhập", () => {
  test("ensure: cookie còn hạn → authed + me; gọi lại không refresh nữa", async () => {
    routes["/auth/refresh"] = [ok(grant("t1"))];
    expect(await session.ensure()).toBe("authed");
    expect(await session.ensure()).toBe("authed");
    expect(session.getState()).toMatchObject({ accessToken: "t1", me });
    expect(calls).toHaveLength(1);
  });

  test("ensure: refresh 401 → anon", async () => {
    routes["/auth/refresh"] = [fail(401, "INVALID_REFRESH_TOKEN")];
    expect(await session.ensure()).toBe("anon");
  });

  test("login authenticated → authed; password_change_required → trả về, không đổi phiên", async () => {
    routes["/auth/login"] = [
      {
        status: 200,
        body: { status: "password_change_required", change_token: "c", expires_in: 600 },
      },
      ok(grant("t2")),
    ];
    const req = { tenant_key: "acme", username: "binh", password: "pw" };
    expect((await session.login(req)).status).toBe("password_change_required");
    expect(session.getState().status).toBe("unknown");
    expect((await session.login(req)).status).toBe("authenticated");
    expect(session.getState()).toMatchObject({ status: "authed", accessToken: "t2" });
  });
});

describe("CHAT-AC-03 · 401 Hub → refresh 1 lần", () => {
  test("AUTH_EXPIRED → refresh → gửi lại với token mới, phiên giữ authed", async () => {
    session.applyGrant(grant("old"));
    routes["/conversations"] = [fail(401, "AUTH_EXPIRED"), ok({ items: [] })];
    routes["/auth/refresh"] = [ok(grant("new"))];
    expect(await api<unknown>("/conversations")).toEqual({ items: [] });
    expect(calls.map((c) => `${c.path} ${c.auth ?? "-"}`)).toEqual([
      "/conversations Bearer old",
      "/auth/refresh -",
      "/conversations Bearer new",
    ]);
    expect(session.getState()).toMatchObject({ status: "authed", accessToken: "new" });
  });

  test("3 request 401 đồng thời → 1 lần refresh", async () => {
    session.applyGrant(grant("old"));
    routes["/x"] = [
      fail(401, "AUTH_EXPIRED"),
      fail(401, "AUTH_EXPIRED"),
      fail(401, "AUTH_EXPIRED"),
      ok(1),
      ok(1),
      ok(1),
    ];
    routes["/auth/refresh"] = [ok(grant("new"))];
    expect(await Promise.all([api<number>("/x"), api<number>("/x"), api<number>("/x")])).toEqual([
      1, 1, 1,
    ]);
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
  });
});

describe("CHAT-AC-03 · refresh hỏng / không vòng refresh", () => {
  test("refresh 401 → xoá phiên, status expired, phát `expired`, ném 401 gốc", async () => {
    session.applyGrant(grant("old"));
    let expired = 0;
    const off = session.on("expired", () => expired++);
    routes["/x"] = [fail(401, "AUTH_EXPIRED")];
    routes["/auth/refresh"] = [fail(401, "REFRESH_SUPERSEDED"), fail(401, "INVALID_REFRESH_TOKEN")];
    const e = (await api<unknown>("/x").catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe("AUTH_EXPIRED");
    expect(session.getState()).toEqual({ status: "expired", accessToken: null, me: null });
    expect(expired).toBe(1);
    off();
  });

  test("refresh mất mạng → ném NETWORK_ERROR, giữ phiên", async () => {
    session.applyGrant(grant("old"));
    routes["/x"] = [fail(401, "AUTH_EXPIRED")];
    routes["/auth/refresh"] = ["network"];
    const e = (await api<unknown>("/x").catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe("NETWORK_ERROR");
    expect(session.getState()).toMatchObject({ status: "authed", accessToken: "old" });
  });

  test("/auth/me 401 không refresh", async () => {
    session.applyGrant(grant("old"));
    routes["/auth/me"] = [fail(401, "UNAUTHORIZED")];
    await api<unknown>("/auth/me").catch(() => undefined);
    expect(calls.map((c) => c.path)).toEqual(["/auth/me"]);
    expect(session.getState().status).toBe("authed");
  });
});

describe("CHAT-AC-01 · đăng xuất", () => {
  test("logout lỗi mạng vẫn xoá phiên + phát `cleared`", async () => {
    session.applyGrant(grant("old"));
    let cleared = 0;
    const off = session.on("cleared", () => cleared++);
    routes["/auth/logout"] = ["network"];
    await session.logout();
    expect(session.getState()).toEqual({ status: "anon", accessToken: null, me: null });
    expect(cleared).toBe(1);
    off();
  });
});

describe("review C1 #2 · phiên kết thúc → xoá mọi nháp chat:draft:*", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const memory = () => {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    };
  };
  let ls = memory();
  beforeEach(() => {
    ls = memory();
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    ls.setItem("chat:draft:u1:new:main", "bí mật");
    ls.setItem("chat:draft:u1:c1:f1", "nháp flow");
    ls.setItem("chat:tenant", "acme");
  });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  test("đăng xuất → xoá nháp, giữ khoá khác", async () => {
    session.applyGrant(grant("old"));
    routes["/auth/logout"] = [{ status: 204 }];
    await session.logout();
    expect(ls.getItem("chat:draft:u1:new:main")).toBeNull();
    expect(ls.getItem("chat:draft:u1:c1:f1")).toBeNull();
    expect(ls.getItem("chat:tenant")).toBe("acme");
  });

  test("hết phiên (refresh hỏng) → xoá nháp", async () => {
    session.applyGrant(grant("old"));
    routes["/x"] = [fail(401, "AUTH_EXPIRED")];
    routes["/auth/refresh"] = [
      fail(401, "INVALID_REFRESH_TOKEN"),
      fail(401, "INVALID_REFRESH_TOKEN"),
    ];
    await api<unknown>("/x").catch(() => undefined);
    expect(session.getState().status).toBe("expired");
    expect(ls.length).toBe(1);
  });
});

describe("review C1 #5 · token từ tab khác kèm `sub`", () => {
  const meA = { ...me, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as Me;
  const grantA = (token: string): TokenGrant => ({ ...grant(token), user: meA });

  test("cùng user → nhận token mới, giữ me", () => {
    session.applyGrant(grantA("old"));
    session.receive({ type: "token", accessToken: "t2", at: Date.now(), sub: meA.id });
    expect(session.getState()).toMatchObject({ status: "authed", accessToken: "t2", me: meA });
  });

  test("user khác → xoá phiên tab này + phát `cleared`, không ghép token với me cũ", () => {
    session.applyGrant(grantA("old"));
    let cleared = 0;
    const off = session.on("cleared", () => cleared++);
    session.receive({ type: "token", accessToken: "tB", at: Date.now(), sub: "other-user" });
    expect(session.getState()).toEqual({ status: "anon", accessToken: null, me: null });
    expect(cleared).toBe(1);
    off();
  });

  test("thiếu sub (tab cũ) → giữ hành vi cũ: nhận token", () => {
    session.applyGrant(grantA("old"));
    session.receive({ type: "token", accessToken: "t3", at: Date.now() });
    expect(session.getState().accessToken).toBe("t3");
  });
});
