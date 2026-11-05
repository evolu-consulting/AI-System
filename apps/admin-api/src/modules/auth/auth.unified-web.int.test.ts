// CR-118 · cr118-auth · web gộp workspace-web: MỘT phiên `X-App: contracts` cho cả SHT và Community (spec CR-118 §2). Endpoint có
// sẵn, không đổi — test xác nhận: đối tác đổi mật khẩu bắt buộc ⇒ cookie `ai_rt_contracts` (không `ai_rt_community`); bước TOTP
// với X-App contracts ⇒ cookie contracts; đăng xuất xoá đúng một phiên (chat còn); chéo tenant bị từ chối.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ExternalOrgSchema,
  SsoCodeResponseSchema,
  TokenGrantSchema,
  UserCreateResponseSchema,
} from "@ai/contracts";
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
  await env.owner`delete from admin.users where kind = 'external'`;
  await env.owner`delete from admin.external_orgs`;
  await env.reset();
});

const CT = { "X-App": "contracts" };
const NEW_PW = "Doi-tac-web-gop-2026!";
const cookieNamed = (res: Res, name: string): string | undefined => {
  for (const c of res.cookies) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m?.[1]) return `${name}=${m[1]}`;
  }
  return undefined;
};
const login = (tenant: string, username: string, password: string, headers = CT) =>
  env.post("/auth/login", { body: { tenant_key: tenant, username, password }, headers });

function expectContractsCookie(res: Res): string {
  const set = res.cookies.find((c) => c.startsWith("ai_rt_contracts="));
  expect(set).toMatch(/HttpOnly/i);
  expect(res.cookies.some((c) => /^ai_rt(_chat|_community)?=/.test(c))).toBe(false);
  return cookieNamed(res, "ai_rt_contracts") as string;
}

async function newPartner(username = "ncc1"): Promise<void> {
  const t = await env.token("acme", "binh");
  const o = await env.post("/admin/external-orgs", { token: t, body: { name: `Cty ${username}` } });
  const org = ExternalOrgSchema.parse(o.json).id;
  const u = await env.post(`/admin/external-orgs/${org}/users`, {
    token: t,
    body: { username, display_name: `Đối tác ${username}` },
  });
  const { user } = UserCreateResponseSchema.parse(u.json);
  await env.owner`update admin.users set password_hash = ${env.hashes.pw}, must_change_password = true where id = ${user.id}`;
}

describe("CR-118 · web gộp: một phiên X-App contracts", () => {
  it("đối tác lần đầu qua web gộp: buộc đổi mật khẩu ⇒ cookie ai_rt_contracts, kind external", async () => {
    await newPartner();
    const first = await login("acme", "ncc1", PW);
    expect(first.json.status).toBe("password_change_required");
    expect(first.cookies.some((c) => c.startsWith("ai_rt"))).toBe(false);
    const ch = await env.post("/auth/change-password", {
      body: { change_token: first.json.change_token, new_password: NEW_PW },
      headers: CT,
    });
    expect(ch.status).toBe(200);
    expect(TokenGrantSchema.parse(ch.json).user.kind).toBe("external");
    const ck = expectContractsCookie(ch);
    expect((await env.post("/auth/refresh", { cookie: ck, headers: CT })).status).toBe(200);
  });

  it("đăng xuất xoá một phiên: refresh contracts bị từ chối, phiên chat của cùng người vẫn refresh được", async () => {
    const ct = expectContractsCookie(await login("acme", "an", PW));
    const chat = cookieNamed(await login("acme", "an", PW, { "X-App": "chat" }), "ai_rt_chat");
    expect(chat).toBeDefined();
    const out = await env.post("/auth/logout", { cookie: ct, headers: CT });
    expect(out.status).toBe(204);
    expectErr(
      await env.post("/auth/refresh", { cookie: ct, headers: CT }),
      "INVALID_REFRESH_TOKEN",
    );
    const still = await env.post("/auth/refresh", { cookie: chat, headers: { "X-App": "chat" } });
    expect(still.status).toBe(200);
  });

  it("chéo tenant: đối tác của acme không đăng nhập bằng mã công ty khác; mã SSO acme redeem với tenant globex ⇒ 401", async () => {
    await newPartner();
    expectErr(await login("globex", "ncc1", PW), "INVALID_CREDENTIALS");
    const s = await env.session("acme", "an", PW, { headers: { "X-App": "chat" } });
    await env.owner`insert into admin.app_catalog (key, name, url, audience, required_feature, sso, sort_order)
      values ('contracts', ${env.owner.json({ vi: "Sổ Hợp Tác" })}, 'https://so.test', 'all', null, true, 20)
      on conflict (key) do update set url = excluded.url, enabled = true, sso = true, required_feature = null`;
    const g = await env.post("/auth/sso/code", { token: s.token, body: { app: "contracts" } });
    expect(g.status).toBe(200);
    const { code } = SsoCodeResponseSchema.parse(g.json);
    const r = await env.post("/auth/sso/redeem", {
      body: { code, tenant_key: "globex" },
      headers: CT,
    });
    expectErr(r, "UNAUTHORIZED");
    expect(r.cookies.some((c) => c.startsWith("ai_rt_contracts=") && !/Max-Age=0/i.test(c))).toBe(
      false,
    );
  });
});
