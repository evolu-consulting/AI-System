// ADM-FR-02, ADM-FR-03 · CR-053: mỗi app web một phiên — `X-App: admin|chat|studio` ⇒ cookie `ai_rt_<app>`; đăng nhập
// app này không cho app kia refresh; đăng xuất app này không xoá phiên app kia; vắng/lạ `X-App` ⇒ cookie `ai_rt` như cũ.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { TokenGrantSchema } from "@ai/contracts";
import { createEnv, type Env, expectErr, PW, type Res } from "../M1/_fixtures";

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
const login = (a?: string) =>
  env.post("/auth/login", {
    body: { tenant_key: "acme", username: "an", password: PW },
    ...(a ? { headers: app(a) } : {}),
  });
/** `name=value` của cookie (còn giá trị) tên `name` trong Set-Cookie. */
const cookieNamed = (res: Res, name: string): string | undefined => {
  for (const c of res.cookies) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m?.[1]) return `${name}=${m[1]}`;
  }
  return undefined;
};
const clears = (res: Res, name: string) =>
  res.cookies.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c));
const refresh = (a: string | undefined, cookie: string | undefined) =>
  env.post("/auth/refresh", { cookie, ...(a ? { headers: app(a) } : {}) });

describe("CR-053 · phiên riêng từng app", () => {
  it("ADM-FR-02 · CR-053 · login X-App: chat ⇒ chỉ Set-Cookie ai_rt_chat (HttpOnly, SameSite=Strict, Path=/auth)", async () => {
    const res = await login("chat");
    expect(res.status).toBe(200);
    TokenGrantSchema.parse(res.json);
    const set = res.cookies.find((c) => c.startsWith("ai_rt_chat="));
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Path=\/auth/i);
    expect(res.cookies.some((c) => /^ai_rt=/.test(c))).toBe(false);
  });

  it("ADM-FR-02 · CR-053 · phiên chat không mở được admin/studio (kể cả trình duyệt gửi kèm cookie chat); chat refresh được", async () => {
    const chat = cookieNamed(await login("chat"), "ai_rt_chat");
    expect(chat).toBeDefined();
    expectErr(await refresh("admin", chat), "INVALID_REFRESH_TOKEN");
    expectErr(await refresh("studio", chat), "INVALID_REFRESH_TOKEN");
    const ok = await refresh("chat", chat);
    expect(ok.status).toBe(200);
    expect(cookieNamed(ok, "ai_rt_chat")).toBeDefined();
  });

  it("ADM-FR-03 · CR-053 · đăng xuất admin chỉ xoá ai_rt_admin; phiên chat vẫn refresh được", async () => {
    const chat = cookieNamed(await login("chat"), "ai_rt_chat");
    const admin = cookieNamed(await login("admin"), "ai_rt_admin");
    const both = `${chat}; ${admin}`;
    const out = await env.post("/auth/logout", { cookie: both, headers: app("admin") });
    expect(out.status).toBe(204);
    expect(clears(out, "ai_rt_admin")).toBe(true);
    expect(out.cookies.some((c) => c.startsWith("ai_rt_chat="))).toBe(false);
    expectErr(await refresh("admin", admin), "INVALID_REFRESH_TOKEN");
    expect((await refresh("chat", chat)).status).toBe(200);
  });

  it("ADM-FR-02 · CR-053 · vắng hoặc lạ X-App (vd `Admin`, `hub`) ⇒ cookie ai_rt như cũ", async () => {
    for (const a of [undefined, "Admin", "hub"]) {
      const res = await login(a);
      expect(cookieNamed(res, "ai_rt")).toBeDefined();
      expect(res.cookies.some((c) => c.startsWith("ai_rt_"))).toBe(false);
    }
  });
});
