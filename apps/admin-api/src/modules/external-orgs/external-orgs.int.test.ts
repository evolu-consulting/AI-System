// CR-102a · ADM-FR-74, ADM-FR-75 · com-c1-ext-identity: /admin/external-orgs* + user ngoài qua HTTP thật (app + DB).
// Viết TRƯỚC code (làn đầy đủ): quyền (member 403, tenant khác 404), user ngoài không vào Group (422), không lên
// tenant_admin, vô hiệu không mở lại, JWT + /auth/me mang kind/ext_org_id, token cũ không claim vẫn dùng được.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ExternalOrgListResponseSchema,
  ExternalOrgSchema,
  MeSchema,
  UserCreateResponseSchema,
  UserListResponseSchema,
} from "@ai/contracts";
import {
  createEnv,
  decode,
  type Env,
  expectErr,
  PW,
  type Res,
  SEED_PW,
  signJwt,
  TENANT_ID,
  USER_ID,
} from "../../../../../tests/acceptance/M1/_fixtures";

const ACCESS_TTL = 900;

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.owner`delete from admin.group_members where tenant_id = ${TENANT_ID.acme}`;
  await env.owner`delete from admin.users where kind = 'external'`;
  await env.owner`delete from admin.external_orgs`;
  await env.reset();
});

const errCode = (r: Res) => r.json?.error?.code as string | undefined;
const binh = () => env.token("acme", "binh");

async function newOrg(name = "NCC Một", token?: string): Promise<string> {
  const r = await env.post("/admin/external-orgs", {
    token: token ?? (await binh()),
    body: { name },
  });
  expect(r.status).toBe(201);
  return ExternalOrgSchema.parse(r.json).id;
}
async function newExtUser(org: string, username = "ncc1") {
  const r = await env.post(`/admin/external-orgs/${org}/users`, {
    token: await binh(),
    body: { username, display_name: "NCC Một - Hà" },
  });
  expect(r.status).toBe(201);
  return UserCreateResponseSchema.parse(r.json);
}
/** Đặt mật khẩu biết trước + bỏ bắt đổi để đăng nhập thẳng (test chỉ cần phiên). */
async function signInable(userId: string) {
  await env.owner`update admin.users set password_hash = ${env.hashes.pw}, must_change_password = false where id = ${userId}`;
}

describe("CR-102a · tenant_admin quản lý công ty đối tác", () => {
  it("ADM-FR-75 · tạo / liệt kê / đổi tên công ty; tên trùng → 409 NAME_TAKEN", async () => {
    const t = await binh();
    const org = await newOrg("NCC Một", t);
    expectErr(
      await env.post("/admin/external-orgs", { token: t, body: { name: "ncc một" } }),
      "NAME_TAKEN",
    );
    const ren = await env.patch(`/admin/external-orgs/${org}`, {
      token: t,
      body: { name: "NCC Một (HN)" },
    });
    expect(ren.status).toBe(200);
    expect(ren.json.name).toBe("NCC Một (HN)");
    const list = ExternalOrgListResponseSchema.parse(
      (await env.get("/admin/external-orgs", { token: t })).json,
    );
    expect(list.items.map((o) => [o.name, o.active, o.user_count])).toEqual([
      ["NCC Một (HN)", true, 0],
    ]);
  });

  it("ADM-FR-75 · tạo user ngoài: kind external, role member, mật khẩu tạm một lần, bắt đổi; liệt kê theo công ty", async () => {
    const org = await newOrg();
    const { user, temp_password } = await newExtUser(org);
    expect(user).toMatchObject({
      kind: "external",
      external_org_id: org,
      role: "member",
      must_change_password: true,
    });
    expect(temp_password.length).toBeGreaterThanOrEqual(12);
    const users = UserListResponseSchema.parse(
      (await env.get(`/admin/external-orgs/${org}/users`, { token: await binh() })).json,
    );
    expect(users.items.map((u) => u.username)).toEqual(["ncc1"]);
    const internal = UserListResponseSchema.parse(
      (await env.get("/admin/users?kind=internal&limit=100", { token: await binh() })).json,
    );
    expect(internal.items.some((u) => u.username === "ncc1")).toBe(false);
    const [audit] = await env.owner`select action, entity from admin.audit_log
      where entity_id = ${user.id} order by seq desc limit 1`;
    expect(audit).toMatchObject({ action: "create", entity: "user" });
  });

  it("ADM-BR-09 · member → 403 mọi route; tenant_admin tenant khác → 404 (không lộ tồn tại)", async () => {
    const org = await newOrg();
    const member = await env.token("acme", "an");
    expect((await env.get("/admin/external-orgs", { token: member })).status).toBe(403);
    expect(
      (await env.post("/admin/external-orgs", { token: member, body: { name: "x" } })).status,
    ).toBe(403);
    expect(
      (await env.post(`/admin/external-orgs/${org}/users`, { token: member, body: {} })).status,
    ).toBe(403);
    const hoa = await env.token("globex", "hoa");
    expectErr(await env.get(`/admin/external-orgs/${org}`, { token: hoa }), "NOT_FOUND");
    expectErr(
      await env.patch(`/admin/external-orgs/${org}`, { token: hoa, body: { name: "x" } }),
      "NOT_FOUND",
    );
    expectErr(
      await env.post(`/admin/external-orgs/${org}/users`, {
        token: hoa,
        body: { username: "x1", display_name: "X" },
      }),
      "NOT_FOUND",
    );
    const list = ExternalOrgListResponseSchema.parse(
      (await env.get("/admin/external-orgs", { token: hoa })).json,
    );
    expect(list.total).toBe(0);
  });

  it("platform_admin tạo công ty + user ngoài cho tenant bất kỳ (?tenant_id=)", async () => {
    const admin = (await env.session("platform", "admin", SEED_PW)).token;
    const r = await env.post(`/admin/external-orgs?tenant_id=${TENANT_ID.acme}`, {
      token: admin,
      body: { name: "NCC Platform" },
    });
    expect(r.status).toBe(201);
    expect(r.json.tenant_id).toBe(TENANT_ID.acme);
    const u = await env.post(`/admin/external-orgs/${r.json.id}/users`, {
      token: admin,
      body: { username: "ncc9", display_name: "NCC 9" },
    });
    expect(u.status).toBe(201);
    expect(u.json.user.tenant_id).toBe(TENANT_ID.acme);
  });
});

describe("CR-102a · user ngoài không leo quyền", () => {
  it("không thêm vào Group → 422 EXTERNAL_USER_NOT_ALLOWED (không chèn ai, kể cả user nội bộ đi kèm)", async () => {
    const org = await newOrg();
    await newExtUser(org);
    const t = await binh();
    const g = await env.post("/admin/groups", {
      token: t,
      body: { key: "ke-toan", name: { vi: "Kế toán" } },
    });
    expect(g.status).toBe(201);
    const r = await env.post(`/admin/groups/${g.json.id}/members`, {
      token: t,
      body: { usernames: ["an", "ncc1"] },
    });
    expect(r.status).toBe(422);
    expect(errCode(r)).toBe("EXTERNAL_USER_NOT_ALLOWED");
    expect(r.json.error.details).toEqual({ usernames: ["ncc1"] });
    const [n] =
      await env.owner`select count(*)::int as n from admin.group_members where group_id = ${g.json.id}`;
    expect(n?.n).toBe(0);
  });

  it("PATCH role user ngoài → 422 EXTERNAL_USER_NOT_ALLOWED", async () => {
    const org = await newOrg();
    const { user } = await newExtUser(org);
    const r = await env.patch(`/admin/users/${user.id}`, {
      token: await binh(),
      body: { version: user.version, role: "tenant_admin", email: "x@acme.test" },
    });
    expect(r.status).toBe(422);
    expect(errCode(r)).toBe("EXTERNAL_USER_NOT_ALLOWED");
  });
});

describe("CR-102a · khoá / vô hiệu (không xoá cứng)", () => {
  it("khoá/mở khoá/reset dùng route users; vô hiệu ⇒ không đăng nhập, không mở khoá lại (409 USER_DEACTIVATED)", async () => {
    const org = await newOrg();
    const { user } = await newExtUser(org);
    const t = await binh();
    expect((await env.post(`/admin/users/${user.id}/lock`, { token: t })).json.active).toBe(false);
    expect((await env.post(`/admin/users/${user.id}/unlock`, { token: t })).json.active).toBe(true);
    const reset = await env.post(`/admin/users/${user.id}/reset-password`, { token: t });
    expect(typeof reset.json.temp_password).toBe("string");
    const d = await env.post(`/admin/external-orgs/${org}/users/${user.id}/deactivate`, {
      token: t,
    });
    expect(d.status).toBe(200);
    expect(d.json).toMatchObject({ active: false, status: "locked" });
    expect(d.json.deactivated_at).not.toBeNull();
    const un = await env.post(`/admin/users/${user.id}/unlock`, { token: t });
    expect([un.status, errCode(un)]).toEqual([409, "USER_DEACTIVATED"]);
    await signInable(user.id);
    expectErr(await env.login("acme", "ncc1", PW), "ACCOUNT_LOCKED");
  });

  it("vô hiệu user nội bộ qua route đối tác → 404 (user phải thuộc công ty)", async () => {
    const org = await newOrg();
    expectErr(
      await env.post(`/admin/external-orgs/${org}/users/${USER_ID.an}/deactivate`, {
        token: await binh(),
      }),
      "NOT_FOUND",
    );
  });

  it("vô hiệu công ty ⇒ mọi user của công ty vô hiệu + thu hồi phiên; thêm user → 409 EXTERNAL_ORG_INACTIVE", async () => {
    const org = await newOrg();
    const { user } = await newExtUser(org);
    await signInable(user.id);
    await env.session("acme", "ncc1", PW);
    const t = await binh();
    const r = await env.post(`/admin/external-orgs/${org}/deactivate`, { token: t });
    expect(r.json).toMatchObject({ active: false, active_user_count: 0, user_count: 1 });
    const [u] =
      await env.owner`select active, deactivated_at is not null as d from admin.users where id = ${user.id}`;
    expect(u).toEqual({ active: false, d: true });
    const [rt] =
      await env.owner`select count(*)::int as n from admin.refresh_tokens where user_id = ${user.id} and revoked_at is null`;
    expect(rt?.n).toBe(0);
    const add = await env.post(`/admin/external-orgs/${org}/users`, {
      token: t,
      body: { username: "ncc2", display_name: "NCC 2" },
    });
    expect([add.status, errCode(add)]).toEqual([409, "EXTERNAL_ORG_INACTIVE"]);
  });
});

describe("CR-102a · JWT + /auth/me", () => {
  it("user ngoài: access token có kind/xorg; /auth/me trả kind=external, ext_org_id; refresh giữ claim", async () => {
    const org = await newOrg();
    const { user } = await newExtUser(org);
    await signInable(user.id);
    const s = await env.session("acme", "ncc1", PW, { headers: { "X-Client": "extension" } });
    expect(decode(s.token).claims).toMatchObject({ kind: "external", xorg: org });
    expect(MeSchema.parse(s.user)).toMatchObject({ kind: "external", ext_org_id: org });
    const me = await env.get("/auth/me", { token: s.token });
    expect(me.json).toMatchObject({ kind: "external", ext_org_id: org });
    const rf = await env.post("/auth/refresh", {
      headers: { "X-Client": "extension" },
      body: { refresh_token: s.refresh },
    });
    expect(rf.status).toBe(200);
    expect(decode(rf.json.access_token).claims).toMatchObject({ kind: "external", xorg: org });
  });

  it("user nội bộ: token KHÔNG có claim kind/xorg (giữ token nhỏ); /auth/me kind=internal", async () => {
    const s = await env.session("acme", "an", PW);
    const c = decode(s.token).claims;
    expect(c.kind).toBeUndefined();
    expect(c.xorg).toBeUndefined();
    expect((await env.get("/auth/me", { token: s.token })).json).toMatchObject({
      kind: "internal",
      ext_org_id: null,
    });
  });

  it("token cũ (ký trước 0028, không claim kind) vẫn dùng được ⇒ internal", async () => {
    const old = await signJwt({
      sub: USER_ID.an,
      aud: "ai-system",
      claims: { tid: TENANT_ID.acme, role: "member", sid: null },
      expOffsetS: ACCESS_TTL,
      privatePem: env.keys.privatePem,
    });
    const me = await env.get("/auth/me", { token: old });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ kind: "internal", ext_org_id: null });
  });
});
