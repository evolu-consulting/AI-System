// CHAT-AC-01, CHAT-AC-03 · cấu hình phiên của chat-web (N1 TF3): tên kênh/khoá, X-App, xoá nháp khi phiên kết thúc.
// Logic phiên chung kiểm ở `packages/web-kit/src/auth/session.test.ts`.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Me, TokenGrant } from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";
import { AUTH_CHANNEL_NAME, CHAT_APP, REFRESH_LOCK_NAME, session } from "./session";

const me = { username: "binh", tenant: { key: "acme" } } as unknown as Me;

type Reply = { status: number; body?: unknown };
const realFetch = globalThis.fetch;
let routes: Record<string, Reply[]> = {};
let calls: { path: string; app?: string }[] = [];

const grant = (token: string): TokenGrant => ({
  status: "authenticated",
  access_token: token,
  token_type: "Bearer",
  expires_in: 900,
  user: me,
});
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
    calls.push({ path, app: (init?.headers as Record<string, string>)?.["X-App"] });
    const r = routes[path]?.shift();
    if (!r) throw new Error(`unexpected ${path}`);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("CHAT-AC-03 · tên kênh/khoá riêng của chat", () => {
  test("kênh BroadcastChannel là ai-chat-auth", () => {
    expect(AUTH_CHANNEL_NAME).toBe("ai-chat-auth");
  });

  test("khoá Web Lock là ai-chat-refresh (không tranh khoá với Admin)", () => {
    expect(REFRESH_LOCK_NAME).toBe("ai-chat-refresh");
  });

  test("CR-053 · đăng xuất gửi X-App: chat", async () => {
    session.applyGrant(grant("old"));
    routes["/auth/logout"] = [{ status: 204 }];
    await session.logout();
    expect(CHAT_APP).toBe("chat");
    expect(calls).toEqual([{ path: "/auth/logout", app: "chat" }]);
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
