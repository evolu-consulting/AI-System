// sso-switch · đăng nhập AI System (chat) một lần ⇒ sang contracts-web bằng mã một lần: đường chính, mã hết hạn / dùng lại /
// sai app bị từ chối, mã của công ty này không mở phiên ở web gắn công ty khác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SsoCodeResponseSchema, TokenGrantSchema } from "@ai/contracts";
import { createDb, type Db } from "@ai/db";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  expectErr,
  PW,
  type Res,
  USER_ID,
} from "../../../../../../tests/acceptance/M1/_fixtures";

import { seedAppUrls } from "../../app-catalog/app-catalog.seed";

let env: Env;
let db: Db;
beforeAll(async () => {
  env = await createEnv();
  db = createDb(ADMIN_API_URL, { max: 2 });
});
afterAll(async () => {
  await db.close();
  await env.close();
});
beforeEach(async () => {
  await env.reset();
  // app-catalog: `reset` xoá catalog ⇒ dựng lại bằng seed khởi động; Sổ Hợp Tác không đòi gói để tập trung vào luồng mã.
  await seedAppUrls(db, {
    APP_URL_CHAT: "https://chat.example.com",
    APP_URL_CONTRACTS: "https://so.example.com",
    APP_URL_ADMIN: "https://admin.example.com",
  });
  await env.owner`update admin.app_catalog set required_feature = null where key = 'contracts'`;
});

const app = (a: string) => ({ "X-App": a });
const cookieNamed = (res: Res, name: string): string | undefined => {
  for (const c of res.cookies) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m?.[1]) return `${name}=${m[1]}`;
  }
  return undefined;
};

/** Đăng nhập chat-web (acme/an) rồi xin mã cho contracts. */
async function chatCode(target = "contracts"): Promise<string> {
  const s = await env.session("acme", "an", PW, { headers: app("chat") });
  const res = await env.post("/auth/sso/code", { token: s.token, body: { app: target } });
  expect(res.status).toBe(200);
  return SsoCodeResponseSchema.parse(res.json).code;
}
const redeem = (
  code: string,
  a = "contracts",
  extra: Record<string, string> = {},
  headers: Record<string, string> = {},
) => env.post("/auth/sso/redeem", { body: { code, ...extra }, headers: { ...app(a), ...headers } });

describe("sso-switch · chuyển phiên chat → contracts", () => {
  it("đường chính: mã ⇒ phiên contracts riêng (cookie ai_rt_contracts HttpOnly), refresh được", async () => {
    const res = await redeem(await chatCode(), "contracts", { tenant_key: "acme" });
    expect(res.status).toBe(200);
    const grant = TokenGrantSchema.parse(res.json);
    expect(grant.user.id).toBe(USER_ID.an);
    expect(grant.refresh_token).toBeUndefined();
    const set = res.cookies.find((c) => c.startsWith("ai_rt_contracts="));
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Path=\/auth/i);
    const again = await env.post("/auth/refresh", {
      cookie: cookieNamed(res, "ai_rt_contracts"),
      headers: app("contracts"),
    });
    expect(again.status).toBe(200);
  });

  it("mã dùng lại hoặc đổi ở app khác app được cấp ⇒ 401", async () => {
    const code = await chatCode();
    expect((await redeem(code)).status).toBe(200);
    expectErr(await redeem(code), "UNAUTHORIZED");
    expectErr(await redeem(await chatCode(), "admin"), "UNAUTHORIZED");
  });

  it("mã quá 60 giây ⇒ 401, không Set-Cookie", async () => {
    const code = await chatCode();
    env.clock.advance(61_000);
    const res = await redeem(code);
    expectErr(res, "UNAUTHORIZED");
    expect(res.cookies.some((c) => c.startsWith("ai_rt_contracts="))).toBe(false);
  });

  it("chéo tenant: mã của acme đổi ở web gắn globex ⇒ 401 (và mã đã cháy)", async () => {
    const code = await chatCode();
    expectErr(await redeem(code, "contracts", { tenant_key: "globex" }), "UNAUTHORIZED");
    expectErr(await redeem(code, "contracts", { tenant_key: "acme" }), "UNAUTHORIZED");
  });
});

describe("app-catalog · đích SSO từ catalog (không open redirect)", () => {
  it("đích lấy từ catalog: trả target_url; app tắt/không có URL/không SSO ⇒ 403; Origin lạ khi đổi mã ⇒ 401", async () => {
    const s = await env.session("acme", "an", PW, { headers: app("chat") });
    const ask = (a: string) => env.post("/auth/sso/code", { token: s.token, body: { app: a } });
    const ok = await ask("contracts");
    expect(SsoCodeResponseSchema.parse(ok.json).target_url).toBe("https://so.example.com");
    await env.owner`update admin.app_catalog set url = '' where key = 'contracts'`;
    expectErr(await ask("contracts"), "FORBIDDEN");
    await env.owner`update admin.app_catalog set url = 'https://so.example.com', enabled = false where key = 'contracts'`;
    expectErr(await ask("contracts"), "FORBIDDEN");
    await env.owner`update admin.app_catalog set enabled = true where key = 'contracts'`;
    expectErr(await ask("studio"), "FORBIDDEN"); // studio: chỉ platform_admin (và không SSO)

    const code = SsoCodeResponseSchema.parse((await ask("contracts")).json).code;
    const evil = await redeem(code, "contracts", {}, { Origin: "https://evil.example.com" });
    expectErr(evil, "UNAUTHORIZED");
    expectErr(await redeem(code), "UNAUTHORIZED"); // mã đã cháy
    const code2 = SsoCodeResponseSchema.parse((await ask("contracts")).json).code;
    const good = await redeem(code2, "contracts", {}, { Origin: "https://so.example.com" });
    expect(good.status).toBe(200);
  });
});
