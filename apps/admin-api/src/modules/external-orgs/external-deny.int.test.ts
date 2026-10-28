// CR-102a · com-c2-ext-deny · admin-api qua HTTP thật (app + DB): user ngoài (đối tác) chỉ /auth/me + đổi mật khẩu (+ app
// của mình đã lọc, mã SSO chỉ Community); không làm quản lý / trưởng phòng (API 422 + trigger 0029 ở cả hai cột); vô hiệu
// công ty audit từng user; mở lại công ty; tenant `platform` không có đối tác.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ExternalOrgSchema, UserCreateResponseSchema } from "@ai/contracts";
import {
  createEnv,
  type Env,
  PW,
  type Res,
  SEED_PW,
  USER_ID,
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
  await env.owner`delete from admin.user_managers where tenant_id in (select tenant_id from admin.users where kind = 'external')`;
  await env.owner`update admin.departments set head_user_id = null
    where head_user_id in (select id from admin.users where kind = 'external')`;
  await env.owner`delete from admin.users where kind = 'external'`;
  await env.owner`delete from admin.external_orgs`;
  await env.reset();
});

const errCode = (r: Res) => r.json?.error?.code as string | undefined;
const binh = () => env.token("acme", "binh");

async function extSession(username = "ncc1"): Promise<{ org: string; id: string; token: string }> {
  const t = await binh();
  const o = await env.post("/admin/external-orgs", { token: t, body: { name: `Cty ${username}` } });
  const org = ExternalOrgSchema.parse(o.json).id;
  const u = await env.post(`/admin/external-orgs/${org}/users`, {
    token: t,
    body: { username, display_name: `Đối tác ${username}` },
  });
  const { user } = UserCreateResponseSchema.parse(u.json);
  await env.owner`update admin.users set password_hash = ${env.hashes.pw}, must_change_password = false where id = ${user.id}`;
  return { org, id: user.id, token: (await env.session("acme", username, PW)).token };
}

describe("com-c2 · cổng trung tâm admin-api cho đối tác", () => {
  it("chỉ /auth/me (+ đổi mật khẩu, app của mình); /admin/*, góp ý, 2FA ⇒ 403; nội bộ không đổi", async () => {
    const { token } = await extSession();
    expect((await env.get("/auth/me", { token })).status).toBe(200);
    expect((await env.patch("/auth/me", { token, body: { locale: "vi" } })).status).toBe(200);
    expect((await env.get("/me/apps", { token })).status).toBe(200);
    const cp = await env.post("/auth/change-password", {
      token,
      body: { current_password: "sai-mat-khau-1", new_password: "Mat-khau-moi-123!" },
    });
    expect(cp.status).not.toBe(403);
    for (const [m, p] of [
      ["GET", "/admin/users"],
      ["GET", "/admin/org"],
      ["GET", "/admin/groups"],
      ["GET", "/admin/audit"],
      ["GET", "/auth/feedback"],
      ["POST", "/auth/totp/setup"],
      ["PUT", "/me/tenant-default-app"],
    ] as const) {
      const r =
        m === "GET" ? await env.get(p, { token }) : await env.call(m, p, { token, body: {} });
      expect({ p, s: r.status, c: errCode(r) }).toEqual({ p, s: 403, c: "FORBIDDEN" });
    }
    const an = await env.token("acme", "an");
    expect((await env.get("/auth/feedback", { token: an })).status).toBe(200);
  });

  it("app catalog + portal + SSO: đối tác chỉ thấy/xin mã Community; nội bộ thấy Sổ Hợp Tác", async () => {
    await env.owner`insert into admin.app_catalog (key, name, url, audience, required_feature, sso, sort_order)
      values ('community', ${env.owner.json({ vi: "Cộng đồng" })}, 'https://community.test', 'all', null, true, 50)
      on conflict (key) do update set url = excluded.url, enabled = true`;
    for (const [key, audience] of [
      ["admin", "admin"],
      ["chat", "all"],
    ] as const)
      await env.owner`insert into admin.app_catalog (key, name, url, audience, sso)
        values (${key}, ${env.owner.json({ vi: key })}, ${`https://${key}.test`}, ${audience}, true)
        on conflict (key) do update set url = excluded.url, enabled = true`;
    const { token } = await extSession();
    const apps = await env.get("/me/apps", { token });
    expect(apps.json.items.map((a: { key: string }) => a.key)).toEqual(["community"]);
    const portal = await env.get("/me/portal", { token });
    expect(portal.json).toMatchObject({ chat: false, default_app: { effective: "community" } });
    for (const app of ["contracts", "chat", "admin"]) {
      const r = await env.post("/auth/sso/code", { token, body: { app } });
      expect({ app, s: r.status }).toEqual({ app, s: 403 });
    }
    // C3: `community` thuộc `WEB_APPS` ⇒ đối tác xin được mã SSO sang community-web (đích = URL catalog).
    const cm = await env.post("/auth/sso/code", { token, body: { app: "community" } });
    expect({ s: cm.status, url: cm.json?.target_url }).toEqual({
      s: 200,
      url: "https://community.test",
    });
    const setOther = await env.call("PUT", "/me/default-app", {
      token,
      body: { app: "contracts" },
    });
    expect(errCode(setOther)).toBe("INVALID_REFERENCE");
    const binhApps = await env.get("/me/apps", { token: await binh() });
    expect(binhApps.json.items.map((a: { key: string }) => a.key)).toEqual(
      expect.arrayContaining(["admin", "chat", "community"]),
    );
  });
});

describe("com-c2 (TB-1) · đối tác không vào cây quản lý / trưởng phòng", () => {
  it("API: đặt quản lý (hai chiều) / trưởng phòng là đối tác ⇒ 422; nội bộ vẫn đặt được", async () => {
    const { id } = await extSession();
    const t = await binh();
    const asManager = await env.call("PUT", `/admin/org/managers/${USER_ID.an}`, {
      token: t,
      body: { manager_id: id },
    });
    expect([asManager.status, errCode(asManager)]).toEqual([422, "EXTERNAL_USER_NOT_ALLOWED"]);
    const managed = await env.call("PUT", `/admin/org/managers/${id}`, {
      token: t,
      body: { manager_id: USER_ID.binh },
    });
    expect([managed.status, errCode(managed)]).toEqual([422, "EXTERNAL_USER_NOT_ALLOWED"]);
    const ok = await env.call("PUT", `/admin/org/managers/${USER_ID.an}`, {
      token: t,
      body: { manager_id: USER_ID.binh },
    });
    expect(ok.status).toBe(200);
    const g = await env.post("/admin/groups", {
      token: t,
      body: { key: "phong-c2", name: { vi: "Phòng C2" } },
    });
    const head = await env.call("PUT", `/admin/org/departments/${g.json.id}`, {
      token: t,
      body: { head_user_id: id },
    });
    expect([head.status, errCode(head)]).toEqual([422, "EXTERNAL_USER_NOT_ALLOWED"]);
    const headOk = await env.call("PUT", `/admin/org/departments/${g.json.id}`, {
      token: t,
      body: { head_user_id: USER_ID.binh },
    });
    expect(headOk.status).toBe(200);
  });

  it("DB (trigger 0029): ghi thẳng user_managers / departments.head_user_id với đối tác ⇒ 23514", async () => {
    const { id } = await extSession();
    const [{ tenant_id: tid } = { tenant_id: "" }] =
      await env.owner`select tenant_id from admin.users where id = ${id}`;
    const fail = async (q: Promise<unknown>) => {
      const e = await q.then(
        () => null,
        (x: { code?: string; constraint_name?: string }) => x,
      );
      return [e?.code, e?.constraint_name];
    };
    expect(
      await fail(
        env.owner`insert into admin.user_managers (tenant_id, user_id, manager_id) values (${tid}, ${USER_ID.an}, ${id})`,
      ),
    ).toEqual(["23514", "user_managers_internal_ck"]);
    expect(
      await fail(
        env.owner`insert into admin.user_managers (tenant_id, user_id, manager_id) values (${tid}, ${id}, ${USER_ID.an})`,
      ),
    ).toEqual(["23514", "user_managers_internal_ck"]);
    const [g] = await env.owner`insert into admin.groups (tenant_id, key, name)
      values (${tid}, 'phong-db-c2', ${env.owner.json({ vi: "P" })}) returning id`;
    expect(
      await fail(
        env.owner`insert into admin.departments (tenant_id, group_id, head_user_id) values (${tid}, ${g?.id}, ${id})`,
      ),
    ).toEqual(["23514", "departments_head_internal_ck"]);
  });
});

describe("com-c2 · vòng đời công ty", () => {
  it("TB-2: vô hiệu công ty ⇒ mỗi user một hàng audit `user`; mở lại công ty ⇒ active, user cũ vẫn vô hiệu", async () => {
    const a = await extSession("ncc1");
    const t = await binh();
    await env.post(`/admin/external-orgs/${a.org}/users`, {
      token: t,
      body: { username: "ncc2", display_name: "Đối tác 2" },
    });
    const d = await env.post(`/admin/external-orgs/${a.org}/deactivate`, { token: t });
    expect(d.json.active).toBe(false);
    const rows = await env.owner`select l.entity_name, l.summary->>'op' as op from admin.audit_log l
      where l.entity = 'user' and l.summary->>'external_org_id' = ${a.org} order by l.entity_name`;
    expect(rows.map((r) => [r.entity_name, r.op])).toEqual([
      ["ncc1", "deactivate"],
      ["ncc2", "deactivate"],
    ]);
    const re = await env.post(`/admin/external-orgs/${a.org}/reactivate`, { token: t });
    expect(re.status).toBe(200);
    expect(re.json).toMatchObject({ active: true, active_user_count: 0, user_count: 2 });
    const add = await env.post(`/admin/external-orgs/${a.org}/users`, {
      token: t,
      body: { username: "ncc3", display_name: "Đối tác 3" },
    });
    expect(add.status).toBe(201);
    const member = await env.token("acme", "an");
    expect(
      (await env.post(`/admin/external-orgs/${a.org}/reactivate`, { token: member })).status,
    ).toBe(403);
  });

  it("Thấp-3: tạo công ty đối tác trong tenant platform ⇒ 422", async () => {
    const admin = (await env.session("platform", "admin", SEED_PW)).token;
    const [p] = await env.owner`select id from admin.tenants where key = 'platform'`;
    const r = await env.post(`/admin/external-orgs?tenant_id=${p?.id}`, {
      token: admin,
      body: { name: "NCC lạc chỗ" },
    });
    expect([r.status, errCode(r)]).toEqual([422, "EXTERNAL_USER_NOT_ALLOWED"]);
  });
});
