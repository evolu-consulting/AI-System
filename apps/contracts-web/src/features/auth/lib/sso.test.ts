// sso-switch · vào contracts-web bằng mã một lần từ AI System ⇒ ngôn ngữ theo `user.locale` (như đăng nhập form),
// không kẹt `en` mặc định (e2e deployed 01: SSO vào Tổng quan nhưng giao diện tiếng Anh).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { TokenGrant } from "@ai/contracts/chat";
import { i18n, initI18n } from "~/app/i18n";
import { session } from "./session";
import { redeemSso } from "./sso";

const grant = {
  status: "authenticated",
  access_token: "t1",
  token_type: "Bearer",
  expires_in: 900,
  user: { id: "u1", username: "lan", tenant: { key: "demo" }, locale: "vi" },
} as unknown as TokenGrant;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  globalThis.fetch = realFetch;
  session.reset();
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("redeemSso", () => {
  test("đổi mã ⇒ có phiên + đổi sang ngôn ngữ của người dùng", async () => {
    let body: unknown = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify(grant), { status: 200 });
    }) as unknown as typeof fetch;
    await redeemSso("c1", "demo");
    expect(body).toEqual({ code: "c1", tenant_key: "demo" });
    expect(session.getState().status).toBe("authed");
    expect(i18n.language).toBe("vi");
  });
});
