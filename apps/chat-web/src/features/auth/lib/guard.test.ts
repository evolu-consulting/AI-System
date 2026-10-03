// CHAT-AC-01, CHAT-AC-04 · guard: tải trang refresh cookie một lần; không có phiên → /login?next=; đã đăng nhập vào /login → /c/new.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Me, TokenGrant } from "@ai/contracts/chat";
import { isRedirect } from "@tanstack/react-router";
import { session } from "~/lib/auth/session";
import { redirectIfAuthed, requireSession } from "./guard";

const me = { username: "binh", display_name: "Bình", tenant: { key: "acme" } } as unknown as Me;
const grant: TokenGrant = {
  status: "authenticated",
  access_token: "t1",
  token_type: "Bearer",
  expires_in: 900,
  user: me,
};
const realFetch = globalThis.fetch;
let refreshCalls = 0;

const mockRefresh = (ok: boolean) => {
  globalThis.fetch = (async () => {
    refreshCalls++;
    return ok
      ? new Response(JSON.stringify(grant), { status: 200 })
      : new Response(JSON.stringify({ error: { code: "INVALID_REFRESH_TOKEN", message: "x" } }), {
          status: 401,
        });
  }) as unknown as typeof fetch;
};

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  session.reset();
  refreshCalls = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("requireSession", () => {
  test("CHAT-AC-01 · refresh ok → vào được, chỉ gọi refresh một lần", async () => {
    mockRefresh(true);
    expect(await caught(requireSession({ href: "/c/new" }))).toBeNull();
    expect(await caught(requireSession({ href: "/c/new" }))).toBeNull();
    expect(refreshCalls).toBe(1);
  });
  test("CHAT-AC-04 · không có phiên → redirect /login?next=<href>", async () => {
    mockRefresh(false);
    const e = await caught(requireSession({ href: "/c/abc?flow=f1" }));
    expect(isRedirect(e)).toBe(true);
    const opts = (e as { options: { to: string; search: { next: string } } }).options;
    expect(opts.to).toBe("/login");
    expect(opts.search.next).toBe("/c/abc?flow=f1");
  });
});

describe("redirectIfAuthed", () => {
  test("CHAT-AC-01 · đã đăng nhập → /c/new", async () => {
    mockRefresh(true);
    const e = await caught(redirectIfAuthed());
    expect(isRedirect(e)).toBe(true);
    expect((e as { options: { to: string } }).options.to).toBe("/c/new");
  });
  test("CHAT-AC-04 · sau đăng xuất → ở lại /login", async () => {
    mockRefresh(true);
    await session.ensure();
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await session.logout();
    expect(await caught(redirectIfAuthed())).toBeNull();
    expect(isRedirect(await caught(requireSession({ href: "/c/new" })))).toBe(true);
  });
});
