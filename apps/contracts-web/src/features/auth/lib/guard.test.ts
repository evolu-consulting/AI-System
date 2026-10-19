// PK-FR-10 · TF4 · guard: tải trang refresh cookie một lần; không có phiên → /login?next=; đã đăng nhập vào /login → /contracts.
// Cấu hình phiên riêng contracts-web (kênh/khoá không trùng chat-web, `X-App: contracts`).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Me, TokenGrant } from "@ai/contracts/chat";
import { isRedirect } from "@tanstack/react-router";
import { redirectIfAuthed, requireSession } from "./guard";
import { AUTH_CHANNEL_NAME, CONTRACTS_APP, REFRESH_LOCK_NAME, session } from "./session";

const me = { id: "u1", username: "lan", tenant: { key: "acme" } } as unknown as Me;
const grant: TokenGrant = {
  status: "authenticated",
  access_token: "t1",
  token_type: "Bearer",
  expires_in: 900,
  user: me,
};
const realFetch = globalThis.fetch;
let calls: { url: string; app: string | null }[] = [];

const mockRefresh = (ok: boolean) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, app: (init.headers as Record<string, string>)["X-App"] ?? null });
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
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("cấu hình phiên contracts-web", () => {
  test("PK-FR-10 · tên kênh/khoá riêng, khác chat-web", () => {
    expect(AUTH_CHANNEL_NAME).toBe("ai-contracts-auth");
    expect(REFRESH_LOCK_NAME).toBe("ai-contracts-refresh");
    expect([AUTH_CHANNEL_NAME, REFRESH_LOCK_NAME]).not.toContain("ai-chat-auth");
    expect(CONTRACTS_APP).toBe("contracts");
  });
});

describe("requireSession", () => {
  test("PK-FR-10 · refresh ok → vào được, chỉ gọi refresh một lần, gửi X-App: contracts", async () => {
    mockRefresh(true);
    expect(await caught(requireSession({ href: "/contracts" }))).toBeNull();
    expect(await caught(requireSession({ href: "/partners" }))).toBeNull();
    expect(calls).toEqual([{ url: "/auth/refresh", app: "contracts" }]);
  });
  test("PK-FR-10 · không có phiên → redirect /login?next=<href>", async () => {
    mockRefresh(false);
    const e = await caught(requireSession({ href: "/contracts/abc?tab=log" }));
    expect(isRedirect(e)).toBe(true);
    const opts = (e as { options: { to: string; search: { next: string } } }).options;
    expect(opts.to).toBe("/login");
    expect(opts.search.next).toBe("/contracts/abc?tab=log");
  });
});

describe("redirectIfAuthed", () => {
  test("PK-FR-10 · đã đăng nhập → /contracts", async () => {
    mockRefresh(true);
    const e = await caught(redirectIfAuthed());
    expect(isRedirect(e)).toBe(true);
    expect((e as { options: { to: string } }).options.to).toBe("/contracts");
  });
  test("PK-FR-10 · sau đăng xuất → ở lại /login, vùng _authed lại đòi đăng nhập", async () => {
    mockRefresh(true);
    await session.ensure();
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await session.logout();
    expect(await caught(redirectIfAuthed())).toBeNull();
    expect(isRedirect(await caught(requireSession({ href: "/contracts" })))).toBe(true);
  });
});
