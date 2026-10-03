// ADM-FR-01, ADM-FR-08 · TECH-DEBT #31: đăng nhập lại khi phiên hết hạn với user đã bật 2FA (relogin → totp_required → verifyTotp).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Me, TokenGrant } from "@ai/contracts";
import { api } from "../http";
import { session } from "./session";

const me = { username: "binh", tenant: { key: "acme" } } as unknown as Me;

type Reply = { status: number; body?: unknown };
const realFetch = globalThis.fetch;
let routes: Record<string, Reply[]> = {};
let calls: { path: string; body: unknown }[] = [];

function json(r: Reply): Response {
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}

const grant = (token: string): TokenGrant => ({
  status: "authenticated",
  access_token: token,
  token_type: "Bearer",
  expires_in: 900,
  user: me,
});
const unauthorized = { status: 401, body: { error: { code: "UNAUTHORIZED", message: "x" } } };

/** Đưa session về `expired`: có `me`, request 401 và refresh cũng 401. */
async function expire(): Promise<void> {
  session.applyGrant(grant("old"));
  routes["/x"] = [unauthorized];
  routes["/auth/refresh"] = [unauthorized];
  await api("/x").catch(() => undefined);
  expect(session.getState().status).toBe("expired");
}

beforeEach(() => {
  session.reset();
  routes = {};
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0] ?? "";
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = routes[path]?.shift();
    if (!reply) throw new Error(`unexpected ${path}`);
    return json(reply);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("ADM-FR-08 · relogin với 2FA", () => {
  test("totp_required → giữ `expired`, đặt pendingTotp; mã đúng → authed + sự kiện reauthed", async () => {
    await expire();
    let reauthed = 0;
    const off = session.on("reauthed", () => reauthed++);
    routes["/auth/login"] = [
      { status: 200, body: { status: "totp_required", totp_token: "tt", expires_in: 300 } },
    ];
    expect(await session.relogin("pw")).toBe("totp_required");
    expect(session.getState().status).toBe("expired");
    expect(session.getState().pendingTotp).toEqual({
      totpToken: "tt",
      tenantKey: me.tenant.key,
      username: me.username,
    });
    expect(reauthed).toBe(0);

    routes["/auth/totp/verify"] = [{ status: 200, body: { ...grant("new") } }];
    await session.verifyTotp({ code: "123456" });
    expect(calls.at(-1)).toEqual({
      path: "/auth/totp/verify",
      body: { totp_token: "tt", code: "123456" },
    });
    expect(session.getState()).toMatchObject({
      status: "authed",
      accessToken: "new",
      pendingTotp: null,
    });
    expect(reauthed).toBe(1);
    off();
  });
});

describe("ADM-FR-01 · relogin/verifyTotp và sự kiện reauthed", () => {
  test("mật khẩu đúng không 2FA → authenticated + reauthed ngay", async () => {
    await expire();
    let reauthed = 0;
    const off = session.on("reauthed", () => reauthed++);
    routes["/auth/login"] = [{ status: 200, body: { ...grant("n2") } }];
    expect(await session.relogin("pw")).toBe("authenticated");
    expect(session.getState().status).toBe("authed");
    expect(reauthed).toBe(1);
    off();
  });

  test("đăng nhập thường (không hết hạn) qua bước mã không phát reauthed", async () => {
    session.reset();
    let reauthed = 0;
    const off = session.on("reauthed", () => reauthed++);
    routes["/auth/login"] = [
      { status: 200, body: { status: "totp_required", totp_token: "t2", expires_in: 300 } },
    ];
    await session.login({ tenant_key: "acme", username: "binh", password: "pw" });
    routes["/auth/totp/verify"] = [{ status: 200, body: { ...grant("n3") } }];
    await session.verifyTotp({ backup_code: "abcd-efgh" });
    expect(session.getState().status).toBe("authed");
    expect(reauthed).toBe(0);
    off();
  });
});
