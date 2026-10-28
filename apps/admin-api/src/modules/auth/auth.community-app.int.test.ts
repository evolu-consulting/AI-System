// com-fix-community-login · CR-102 · community-web tự đăng nhập (X-App: community) — không cần chat-web:
// nội bộ + đối tác đăng nhập trực tiếp ⇒ cookie riêng `ai_rt_community` (HttpOnly, SameSite=Strict, Path=/auth); đối tác lần đầu
// bị buộc đổi mật khẩu (C2 cho phép) ⇒ phiên community; đối tác vẫn 403 ngoài danh sách C2; đích SSO chỉ là URL catalog
// (không nhận URL từ người gọi; đổi mã từ origin lạ ⇒ 401).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ExternalOrgSchema, TokenGrantSchema, UserCreateResponseSchema } from "@ai/contracts";
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
  await env.owner`delete from admin.app_catalog where key = 'community'`;
  await env.close();
});
beforeEach(async () => {
  await env.owner`delete from admin.users where kind = 'external'`;
  await env.owner`delete from admin.external_orgs`;
  await env.reset();
  await env.owner`insert into admin.app_catalog (key, name, url, audience, required_feature, sso, sort_order)
    values ('community', ${env.owner.json({ vi: "Cộng đồng" })}, 'https://community.test', 'all', null, true, 50)
    on conflict (key) do update set url = excluded.url, enabled = true, sso = true`;
});

const CM = { "X-App": "community" };
const NEW_PW = "Doi-tac-moi-2026!";
const cookieNamed = (res: Res, name: string): string | undefined => {
  for (const c of res.cookies) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m?.[1]) return `${name}=${m[1]}`;
  }
  return undefined;
};
const login = (tenant: string, username: string, password: string) =>
  env.post("/auth/login", { body: { tenant_key: tenant, username, password }, headers: CM });

/** Đối tác mới như seed: must_change_password = true, mật khẩu tạm = PW. */
async function newPartner(username = "ncc1"): Promise<string> {
  const t = await env.token("acme", "binh");
  const o = await env.post("/admin/external-orgs", { token: t, body: { name: `Cty ${username}` } });
  const org = ExternalOrgSchema.parse(o.json).id;
  const u = await env.post(`/admin/external-orgs/${org}/users`, {
    token: t,
    body: { username, display_name: `Đối tác ${username}` },
  });
  const { user } = UserCreateResponseSchema.parse(u.json);
  await env.owner`update admin.users set password_hash = ${env.hashes.pw}, must_change_password = true where id = ${user.id}`;
  return user.id;
}

function expectCommunityCookie(res: Res): string {
  const set = res.cookies.find((c) => c.startsWith("ai_rt_community="));
  expect(set).toMatch(/HttpOnly/i);
  expect(set).toMatch(/SameSite=Strict/i);
  expect(set).toMatch(/Path=\/auth/i);
  expect(res.cookies.some((c) => /^ai_rt(_chat|_contracts)?=/.test(c))).toBe(false);
  return cookieNamed(res, "ai_rt_community") as string;
}

describe("community-web tự đăng nhập (X-App: community)", () => {
  it("nội bộ: login ⇒ chỉ cookie ai_rt_community; refresh/đăng xuất theo đúng app", async () => {
    const res = await login("acme", "an", PW);
    expect(res.status).toBe(200);
    expect(TokenGrantSchema.parse(res.json).user.username).toBe("an");
    const ck = expectCommunityCookie(res);
    expectErr(
      await env.post("/auth/refresh", { cookie: ck, headers: { "X-App": "chat" } }),
      "INVALID_REFRESH_TOKEN",
    );
    const ok = await env.post("/auth/refresh", { cookie: ck, headers: CM });
    expect(ok.status).toBe(200);
    const ck2 = cookieNamed(ok, "ai_rt_community");
    const out = await env.post("/auth/logout", { cookie: ck2, headers: CM });
    expect(out.status).toBe(204);
    expect(out.cookies.some((c) => c.startsWith("ai_rt_community=;") && /Max-Age=0/i.test(c))).toBe(
      true,
    );
    expectErr(
      await env.post("/auth/refresh", { cookie: ck2, headers: CM }),
      "INVALID_REFRESH_TOKEN",
    );
  });

  it("đối tác lần đầu: buộc đổi mật khẩu ⇒ phiên community; /auth/me 200, ngoài C2 vẫn 403", async () => {
    await newPartner();
    const first = await login("acme", "ncc1", PW);
    expect(first.status).toBe(200);
    expect(first.json.status).toBe("password_change_required");
    expect(first.cookies.some((c) => c.startsWith("ai_rt"))).toBe(false);
    const ch = await env.post("/auth/change-password", {
      body: { change_token: first.json.change_token, new_password: NEW_PW },
      headers: CM,
    });
    expect(ch.status).toBe(200);
    const grant = TokenGrantSchema.parse(ch.json);
    expect(grant.user.kind).toBe("external");
    const ck = expectCommunityCookie(ch);
    const token = grant.access_token;
    expect((await env.get("/auth/me", { token })).status).toBe(200);
    for (const p of ["/admin/users", "/auth/feedback"]) {
      const r = await env.get(p, { token });
      expect({ p, s: r.status }).toEqual({ p, s: 403 });
    }
    // lần sau: đăng nhập thẳng bằng mật khẩu mới, refresh bằng cookie community
    const again = await login("acme", "ncc1", NEW_PW);
    expect(again.json.status).toBe("authenticated");
    expectCommunityCookie(again);
    expect((await env.post("/auth/refresh", { cookie: ck, headers: CM })).status).toBe(200);
  });

  it("đích SSO = URL catalog: không nhận URL người gọi; đổi mã từ origin lạ ⇒ 401, đúng origin ⇒ cookie community", async () => {
    const token = await env.token("acme", "an");
    const foreign = await env.post("/auth/sso/code", {
      token,
      body: { app: "community", target_url: "https://evil.example" },
    });
    expect(foreign.status).toBe(400);
    const g = await env.post("/auth/sso/code", { token, body: { app: "community" } });
    expect(g.json.target_url).toBe("https://community.test");
    const evil = await env.post("/auth/sso/redeem", {
      body: { code: g.json.code },
      headers: { ...CM, Origin: "https://evil.example" },
    });
    expectErr(evil, "UNAUTHORIZED");
    const g2 = await env.post("/auth/sso/code", { token, body: { app: "community" } });
    const ok = await env.post("/auth/sso/redeem", {
      body: { code: g2.json.code },
      headers: { ...CM, Origin: "https://community.test" },
    });
    expect(ok.status).toBe(200);
    expectCommunityCookie(ok);
  });
});
