// ADM-FR-02, ADM-FR-03 · CR-053 · N1 PK-FR-10: contracts-web (`X-App: contracts`) có phiên riêng `ai_rt_contracts` —
// đăng nhập/đăng xuất contracts không ảnh hưởng phiên chat/admin và ngược lại (khuôn tests/acceptance/CR-053).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { TokenGrantSchema } from "@ai/contracts";
import {
  createEnv,
  type Env,
  expectErr,
  PW,
  type Res,
} from "../../../../../tests/acceptance/M1/_fixtures";

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
});

const app = (a: string) => ({ "X-App": a });
const login = (a: string) =>
  env.post("/auth/login", {
    body: { tenant_key: "acme", username: "an", password: PW },
    headers: app(a),
  });
const cookieNamed = (res: Res, name: string): string | undefined => {
  for (const c of res.cookies) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m?.[1]) return `${name}=${m[1]}`;
  }
  return undefined;
};
const clears = (res: Res, name: string) =>
  res.cookies.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c));
const refresh = (a: string, cookie: string | undefined) =>
  env.post("/auth/refresh", { cookie, headers: app(a) });

describe("CR-053 · phiên riêng contracts-web", () => {
  it("ADM-FR-02 · login X-App: contracts ⇒ chỉ Set-Cookie ai_rt_contracts (HttpOnly, SameSite=Strict, Path=/auth)", async () => {
    const res = await login("contracts");
    expect(res.status).toBe(200);
    TokenGrantSchema.parse(res.json);
    const set = res.cookies.find((c) => c.startsWith("ai_rt_contracts="));
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Path=\/auth/i);
    expect(res.cookies.some((c) => /^ai_rt=/.test(c) || c.startsWith("ai_rt_chat="))).toBe(false);
  });

  it("ADM-FR-02 · phiên contracts chỉ refresh được qua X-App: contracts; phiên chat không mở contracts", async () => {
    const ct = cookieNamed(await login("contracts"), "ai_rt_contracts");
    const chat = cookieNamed(await login("chat"), "ai_rt_chat");
    expect(ct).toBeDefined();
    expectErr(await refresh("chat", ct), "INVALID_REFRESH_TOKEN");
    expectErr(await refresh("contracts", chat), "INVALID_REFRESH_TOKEN");
    const ok = await refresh("contracts", ct);
    expect(ok.status).toBe(200);
    expect(cookieNamed(ok, "ai_rt_contracts")).toBeDefined();
  });

  it("ADM-FR-03 · đăng xuất contracts chỉ xoá ai_rt_contracts; chat vẫn refresh; và ngược lại", async () => {
    const chat = cookieNamed(await login("chat"), "ai_rt_chat");
    const ct = cookieNamed(await login("contracts"), "ai_rt_contracts");
    const out = await env.post("/auth/logout", {
      cookie: `${chat}; ${ct}`,
      headers: app("contracts"),
    });
    expect(out.status).toBe(204);
    expect(clears(out, "ai_rt_contracts")).toBe(true);
    expect(out.cookies.some((c) => c.startsWith("ai_rt_chat="))).toBe(false);
    expectErr(await refresh("contracts", ct), "INVALID_REFRESH_TOKEN");
    const chat2 = cookieNamed(await refresh("chat", chat), "ai_rt_chat");
    expect(chat2).toBeDefined();

    const ct2 = cookieNamed(await login("contracts"), "ai_rt_contracts");
    const out2 = await env.post("/auth/logout", {
      cookie: `${chat2}; ${ct2}`,
      headers: app("chat"),
    });
    expect(clears(out2, "ai_rt_chat")).toBe(true);
    expect(out2.cookies.some((c) => c.startsWith("ai_rt_contracts="))).toBe(false);
    expect((await refresh("contracts", ct2)).status).toBe(200);
  });
});
