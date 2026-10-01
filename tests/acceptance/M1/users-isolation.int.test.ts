// ADM-BR-09, ADM-BR-08, ADM-BR-05, ADM-FR-04 · cách ly tenant, không tự khoá/hạ + còn ≥ 1 admin, 3 role
// (test-plan A5, nhóm AC-A09 / BR-08 / BR-05; AC-A09, M1-AC05, M1-AC07).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { UserSchema } from "@ai/contracts";
import {
  createEnv,
  type Env,
  expectErr,
  insertRefresh,
  insertUsers,
  PW,
  type Res,
  TENANT_ID,
  UNKNOWN_ID,
  USER_ID,
} from "./_fixtures";

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

const act = (token: string, id: string, action: string) =>
  env.post(`/admin/users/${id}/${action}`, { token });
const patch = (token: string, id: string, body: unknown) =>
  env.patch(`/admin/users/${id}`, { token, body });
const userRow = async (id: string) => {
  const [r] = await env.owner`select * from admin.users where id = ${id}`;
  return r;
};

describe("ADM-BR-09 · AC-A09 · cách ly tenant", () => {
  it("ADM-BR-09 · AC-A09 · binh GET user globex/an → 404 NOT_FOUND, body giống từng byte với uuid không tồn tại và với 'abc'", async () => {
    const binh = await env.token("acme", "binh");
    const target = await env.get(`/admin/users/${USER_ID.globexAn}`, { token: binh });
    const unknown = await env.get(`/admin/users/${UNKNOWN_ID}`, { token: binh });
    const notUuid = await env.get("/admin/users/abc", { token: binh });
    for (const r of [target, unknown, notUuid]) expectErr(r, "NOT_FOUND");
    expect(target.text).toBe(unknown.text);
    expect(target.text).toBe(notUuid.text);
  });

  it("ADM-BR-09 · AC-A09 · PATCH/lock/unlock/logout-all/reset-password user globex → 404 đồng nhất và DB không đổi", async () => {
    const binh = await env.token("acme", "binh");
    const tok = await insertRefresh(env.owner, {
      userId: USER_ID.globexAn,
      tenantId: TENANT_ID.globex,
    });
    const before = await userRow(USER_ID.globexAn);
    const calls: Array<[string, string, unknown?]> = [
      ["PATCH", "", { version: 1, display_name: "Hack" }],
      ["POST", "/lock"],
      ["POST", "/unlock"],
      ["POST", "/logout-all"],
      ["POST", "/reset-password"],
    ];
    for (const [method, suffix, body] of calls) {
      const target = await env.call(method, `/admin/users/${USER_ID.globexAn}${suffix}`, {
        token: binh,
        body,
      });
      const unknown = await env.call(method, `/admin/users/${UNKNOWN_ID}${suffix}`, {
        token: binh,
        body,
      });
      expectErr(target, "NOT_FOUND");
      expect(target.text).toBe(unknown.text);
    }
    const after = await userRow(USER_ID.globexAn);
    expect(after?.active).toBe(true);
    expect(after?.password_hash).toBe(before?.password_hash);
    expect(after?.version).toBe(before?.version);
    const [t] = await env.owner`select revoked_at from admin.refresh_tokens where id = ${tok.id}`;
    expect(t?.revoked_at).toBeNull();
  });

  it("ADM-BR-09 · AC-A09 · hoa (globex) không thấy binh (404); platform admin xem được cả hai tenant", async () => {
    const hoa = await env.token("globex", "hoa");
    expectErr(await env.get(`/admin/users/${USER_ID.binh}`, { token: hoa }), "NOT_FOUND");
    const admin = await env.token("platform", "admin");
    for (const id of [USER_ID.binh, USER_ID.globexAn]) {
      const res = await env.get(`/admin/users/${id}`, { token: admin });
      expect(res.status).toBe(200);
      expect(UserSchema.parse(res.json).id).toBe(id);
    }
  });
});

describe("ADM-BR-08 · M1-AC05 · không tự khoá/hạ role", () => {
  it("ADM-BR-08 · M1-AC05 · hoa (tenant_admin duy nhất) tự khoá → 403 SELF_ACTION_FORBIDDEN; tự hạ role → 403", async () => {
    const hoa = await env.token("globex", "hoa");
    expectErr(await act(hoa, USER_ID.hoa, "lock"), "SELF_ACTION_FORBIDDEN");
    expectErr(
      await patch(hoa, USER_ID.hoa, { version: 1, role: "member" }),
      "SELF_ACTION_FORBIDDEN",
    );
    expect((await userRow(USER_ID.hoa))?.active).toBe(true);
  });
});

describe("ADM-BR-08 · M1-AC05 · luôn còn ≥ 1 admin", () => {
  it("ADM-BR-08 · M1-AC05 · admin lock/hạ role hoa (tenant_admin cuối) → 409 LAST_ADMIN {scope:'tenant'}; có admin thứ hai rồi thì lock thành công", async () => {
    const admin = await env.token("platform", "admin");
    const lock = await act(admin, USER_ID.hoa, "lock");
    expectErr(lock, "LAST_ADMIN");
    expect(lock.json.error.details).toEqual({ scope: "tenant" });
    expectErr(await patch(admin, USER_ID.hoa, { version: 1, role: "member" }), "LAST_ADMIN");
    const created = await env.post(`/admin/users?tenant_id=${TENANT_ID.globex}`, {
      token: admin,
      body: {
        username: "hoa2",
        display_name: "Hoa Hai",
        email: "hoa2@globex.test",
        role: "tenant_admin",
      },
    });
    expect(created.status).toBe(201);
    expect((await act(admin, USER_ID.hoa, "lock")).status).toBe(200);
  });

  it("ADM-BR-08 · M1-R11 · tenant đang khoá vẫn áp: admin lock/hạ zoe (tenant_admin duy nhất của zeta) → 409 LAST_ADMIN", async () => {
    const admin = await env.token("platform", "admin");
    expectErr(await act(admin, USER_ID.zoe, "lock"), "LAST_ADMIN");
    expectErr(await patch(admin, USER_ID.zoe, { version: 1, role: "member" }), "LAST_ADMIN");
  });

  it("ADM-BR-08 · M1-R11 · acme có binh + chi: binh lock chi → 200; admin lock binh → 409; unlock chi rồi lock binh → 200", async () => {
    const binh = await env.token("acme", "binh");
    const admin = await env.token("platform", "admin");
    expect((await act(binh, USER_ID.chi, "lock")).status).toBe(200);
    expectErr(await act(admin, USER_ID.binh, "lock"), "LAST_ADMIN");
    expect((await act(binh, USER_ID.chi, "unlock")).status).toBe(200);
    expect((await act(admin, USER_ID.binh, "lock")).status).toBe(200);
  });

  it("ADM-BR-08 · M1-R11 · đếm admin bỏ qua locked_by_tenant: admin thứ hai active nhưng locked_by_tenant vẫn được tính", async () => {
    const admin = await env.token("platform", "admin");
    const hash = env.hashes.pw;
    await insertUsers(env.owner, [
      {
        id: "01900000-0000-7000-8000-000000000051",
        tenant_id: TENANT_ID.globex,
        username: "hoa3",
        email: "hoa3@globex.test",
        password_hash: hash,
        display_name: "Hoa Ba",
        role: "tenant_admin",
        locale: "vi",
        active: true,
        locked_by_tenant: true,
        must_change_password: false,
        last_login_at: null,
      },
    ]);
    expect((await act(admin, USER_ID.hoa, "lock")).status).toBe(200);
  });

  it("ADM-BR-08 · M1-R11 · đồng thời: binh và chi khoá nhau cùng lúc (10 vòng) → đúng 1×200, acme luôn còn tenant_admin active", async () => {
    for (let round = 0; round < 10; round++) {
      await env.reset();
      const binh = await env.token("acme", "binh");
      const chi = await env.token("acme", "chi");
      const rs = await Promise.all([
        act(binh, USER_ID.chi, "lock"),
        act(chi, USER_ID.binh, "lock"),
      ]);
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      const loser = rs.find((r) => r.status !== 200) as Res;
      expect([401, 409]).toContain(loser.status);
      const [c] = await env.owner`select count(*)::int as n from admin.users
        where tenant_id = ${TENANT_ID.acme} and role = 'tenant_admin' and active`;
      expect(c?.n).toBeGreaterThanOrEqual(1);
    }
  });

  it("ADM-BR-08 · M1-R11 · đồng thời: admin và admin2 khoá nhau (10 vòng) → luôn còn ≥ 1 platform_admin active", async () => {
    for (let round = 0; round < 10; round++) {
      await env.reset();
      const a = await env.session("platform", "admin", "Seed-Admin-Pw-01");
      const b = await env.session("platform", "admin2", PW);
      const rs = await Promise.all([
        act(a.token, USER_ID.admin2, "lock"),
        act(b.token, (a.user as { id: string }).id, "lock"),
      ]);
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      const [c] = await env.owner`select count(*)::int as n from admin.users
        where role = 'platform_admin' and active`;
      expect(c?.n).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("ADM-BR-05 · M1-AC07 · member không quản trị", () => {
  it("ADM-BR-05 · M1-AC07 · member (an) gọi mọi /admin/users* → 403 FORBIDDEN, kể cả body sai và id lạ", async () => {
    const an = await env.token("acme", "an");
    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/admin/users"],
      ["POST", "/admin/users", { sai: true }],
      ["GET", `/admin/users/${UNKNOWN_ID}`],
      ["PATCH", `/admin/users/${UNKNOWN_ID}`, { sai: true }],
      ["POST", `/admin/users/${UNKNOWN_ID}/lock`],
      ["POST", `/admin/users/${UNKNOWN_ID}/unlock`],
      ["POST", `/admin/users/${UNKNOWN_ID}/logout-all`],
      ["POST", `/admin/users/${UNKNOWN_ID}/reset-password`],
    ];
    for (const [m, p, body] of calls)
      expectErr(await env.call(m, p, { token: an, body }), "FORBIDDEN");
  });

  it("ADM-BR-05 · M1-R12 · member vẫn gọi được /auth/me và /auth/logout", async () => {
    const s = await env.session("acme", "an", PW);
    expect((await env.get("/auth/me", { token: s.token })).status).toBe(200);
    expect((await env.post("/auth/logout", { cookie: s.cookie })).status).toBe(204);
  });

  it("ADM-BR-05 · M1-R12 · tenant_admin không tạo/gán platform_admin; platform_admin chỉ tồn tại ở tenant platform", async () => {
    const binh = await env.token("acme", "binh");
    const body = { username: "px", display_name: "Px", role: "platform_admin" };
    expectErr(await env.post("/admin/users", { token: binh, body }), "ROLE_NOT_ALLOWED");
    expectErr(
      await patch(binh, USER_ID.an, { version: 1, role: "platform_admin" }),
      "ROLE_NOT_ALLOWED",
    );
    const rows =
      await env.owner`select t.key from admin.users u join admin.tenants t on t.id = u.tenant_id
      where u.role = 'platform_admin'`;
    expect(new Set(rows.map((r) => r.key))).toEqual(new Set(["platform"]));
  });
});
