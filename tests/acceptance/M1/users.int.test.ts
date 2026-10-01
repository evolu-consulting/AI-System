// ADM-FR-04, ADM-FR-05, ADM-FR-63 · /admin/users: list, tạo, sửa, khoá, reset (test-plan A5; AC-A02, M1-AC07).
// Phần cách ly tenant (AC-A09), BR-08, BR-05 nằm ở users-isolation.int.test.ts (giới hạn 600 dòng/file test).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  TempPasswordResponseSchema,
  UserCreateResponseSchema,
  UserListResponseSchema,
  UserSchema,
  versionConflictDetailsSchema,
} from "@ai/contracts";
import {
  createEnv,
  type Env,
  expectErr,
  PW,
  TEMP_PW,
  TENANT_ID,
  USER_ID,
  wrongLogins,
} from "./_fixtures";

let env: Env;
let binh: string;
let admin: string;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
  binh = await env.token("acme", "binh");
  admin = await env.token("platform", "admin");
});

const list = async (token: string, qs = "") => {
  const res = await env.get(`/admin/users${qs}`, { token });
  return { res, body: res.status === 200 ? UserListResponseSchema.parse(res.json) : undefined };
};
const names = (b: { items: Array<{ username: string }> } | undefined) =>
  b?.items.map((u) => u.username);
const create = (token: string, body: unknown, qs = "") =>
  env.post(`/admin/users${qs}`, { token, body });
const member = (username: string, over: Record<string, unknown> = {}) => ({
  username,
  display_name: `User ${username}`,
  role: "member",
  ...over,
});
const getUser = async (token: string, id: string) =>
  UserSchema.parse((await env.get(`/admin/users/${id}`, { token })).json);
const patch = (token: string, id: string, body: unknown) =>
  env.patch(`/admin/users/${id}`, { token, body });
const act = (token: string, id: string, action: string) =>
  env.post(`/admin/users/${id}/${action}`, { token });
const userRow = async (id: string) => {
  const [r] = await env.owner`select * from admin.users where id = ${id}`;
  return r;
};
const revokedReasons = async (userId: string) =>
  (await env.owner`select revoked_reason from admin.refresh_tokens where user_id = ${userId}`).map(
    (r) => r.revoked_reason,
  );

describe("ADM-FR-04 · danh sách và bộ lọc", () => {
  it("ADM-FR-04 · ADM-BR-09 · tenant_admin chỉ thấy user tenant mình (7), bỏ qua ?tenant_id khác; sắp theo username", async () => {
    const own = await list(binh);
    expect(names(own.body)).toEqual(["an", "binh", "chi", "dung", "em", "lan", "thu"]);
    expect(own.body?.items.every((u) => u.tenant_key === "acme")).toBe(true);
    const other = await list(binh, `?tenant_id=${TENANT_ID.globex}`);
    expect(names(other.body)).toEqual(names(own.body));
  });

  it("ADM-FR-04 · M1-R14 · platform_admin: không tenant_id → mọi tenant (14, có tenant_key); ?tenant_id=globex → 3 user", async () => {
    const all = await list(admin);
    expect(all.body?.total).toBe(14);
    expect(names(all.body)).toEqual([
      "admin",
      "admin2",
      "an",
      "an",
      "binh",
      "chi",
      "dung",
      "em",
      "hoa",
      "khang",
      "lan",
      "thu",
      "zed",
      "zoe",
    ]);
    const globex = await list(admin, `?tenant_id=${TENANT_ID.globex}`);
    expect(names(globex.body)).toEqual(["an", "hoa", "khang"]);
  });

  it("ADM-FR-04 · M1-R19 · q khớp username/display_name/email không phân biệt hoa thường", async () => {
    expect(names((await list(binh, "?q=LAN")).body)).toEqual(["lan"]);
    expect(names((await list(binh, "?q=tran")).body)).toEqual(["lan"]);
    expect(names((await list(binh, "?q=NGUYEN")).body)).toEqual(["an"]);
    expect(names((await list(binh, "?q=%40ACME.test")).body)).toEqual(["binh", "chi", "lan"]);
  });

  it("ADM-FR-04 · M1-R19 · lọc role, status=locked, login=never", async () => {
    expect(names((await list(binh, "?role=tenant_admin")).body)).toEqual(["binh", "chi"]);
    expect(names((await list(binh, "?status=locked")).body)).toEqual(["em"]);
    expect(names((await list(binh, "?login=never")).body)).toEqual([
      "an",
      "dung",
      "em",
      "lan",
      "thu",
    ]);
  });

  it("ADM-FR-04 · M1-R19 · counts tính theo cùng bộ lọc trừ status", async () => {
    const base = await list(binh);
    expect(base.body?.counts).toEqual({ all: 7, active: 6, locked: 1 });
    const locked = await list(binh, "?status=locked");
    expect(locked.body?.counts).toEqual({ all: 7, active: 6, locked: 1 });
    const admins = await list(binh, "?role=tenant_admin&status=locked");
    expect(admins.body?.items).toEqual([]);
    expect(admins.body?.counts).toEqual({ all: 2, active: 2, locked: 0 });
  });

  it("ADM-FR-04 · M1-R19 · limit/offset/total; limit=201, login=sometimes, tham số lạ → 400", async () => {
    const page = await list(binh, "?limit=2&offset=1");
    expect(names(page.body)).toEqual(["binh", "chi"]);
    expect(page.body?.total).toBe(7);
    for (const qs of ["?limit=201", "?login=sometimes", "?foo=1", "?role=boss"]) {
      expectErr((await list(binh, qs)).res, "VALIDATION_ERROR");
    }
  });

  it("ADM-FR-07 · M1-R03 · locked_until hiện trong User khi bị khoá tạm", async () => {
    await wrongLogins(env, "acme", "lan", 5);
    const lan = (await list(binh, "?q=lan")).body?.items[0];
    expect(lan?.locked_until).toBe("2026-10-01T09:15:00.000Z");
    expect(lan?.status).toBe("active");
  });
});

describe("ADM-FR-04 · tạo user", () => {
  it("ADM-FR-04 · M1-R17 · binh tạo member → 201 {user, temp_password 16 ký tự}, must_change_password, locale vi, thuộc acme; đăng nhập → password_change_required", async () => {
    const res = await create(binh, member("nam"));
    expect(res.status).toBe(201);
    const b = UserCreateResponseSchema.parse(res.json);
    expect(b.temp_password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect([b.user.must_change_password, b.user.locale, b.user.tenant_key]).toEqual([
      true,
      "vi",
      "acme",
    ]);
    expect(b.user.tenant_id).toBe(TENANT_ID.acme);
    const login = await env.login("acme", "nam", b.temp_password);
    expect(login.json.status).toBe("password_change_required");
  });

  it("ADM-FR-04 · M1-R14 · platform_admin: thiếu ?tenant_id → 400 TENANT_REQUIRED; tenant lạ → 404; có ?tenant_id → tạo ở tenant đó", async () => {
    expectErr(await create(admin, member("nam")), "TENANT_REQUIRED");
    expectErr(
      await create(admin, member("nam"), "?tenant_id=01900000-0000-7000-8000-000000000999"),
      "NOT_FOUND",
    );
    const res = await create(admin, member("nam"), `?tenant_id=${TENANT_ID.globex}`);
    expect(res.status).toBe(201);
    expect(UserCreateResponseSchema.parse(res.json).user.tenant_key).toBe("globex");
  });

  it("ADM-BR-09 · M1-R13 · tenant_admin truyền ?tenant_id=globex → vẫn tạo ở acme", async () => {
    const res = await create(binh, member("nam"), `?tenant_id=${TENANT_ID.globex}`);
    expect(res.status).toBe(201);
    expect(UserCreateResponseSchema.parse(res.json).user.tenant_key).toBe("acme");
  });

  it("ADM-FR-63 · M1-AC07 · 'kim' tạo được ở cả acme và globex; 'an' trùng trong acme (cả 'AN') → 409 USERNAME_TAKEN", async () => {
    expect((await create(binh, member("kim"))).status).toBe(201);
    const hoa = await env.token("globex", "hoa");
    expect((await create(hoa, member("kim"))).status).toBe(201);
    for (const username of ["an", "AN"]) {
      expectErr(await create(binh, member(username)), "USERNAME_TAKEN");
    }
  });

  it("ADM-FR-63 · M1-R16 · email trùng không phân biệt hoa thường → 409 EMAIL_TAKEN; cùng email ở tenant khác được", async () => {
    expectErr(await create(binh, member("nam", { email: "LAN@ACME.test" })), "EMAIL_TAKEN");
    const hoa = await env.token("globex", "hoa");
    expect((await create(hoa, member("nam", { email: "lan@acme.test" }))).status).toBe(201);
  });

  it("ADM-BR-05 · M1-R12 · ROLE_NOT_ALLOWED: binh tạo platform_admin; admin tạo member ở tenant platform; admin tạo platform_admin ở acme", async () => {
    expectErr(await create(binh, member("nam", { role: "platform_admin" })), "ROLE_NOT_ALLOWED");
    const [p] = await env.owner`select id from admin.tenants where key = 'platform'`;
    expectErr(await create(admin, member("nam"), `?tenant_id=${p?.id}`), "ROLE_NOT_ALLOWED");
    const res = await create(
      admin,
      member("nam", { role: "platform_admin" }),
      `?tenant_id=${TENANT_ID.acme}`,
    );
    expectErr(res, "ROLE_NOT_ALLOWED");
  });

  it("ADM-FR-04 · M1-R16 · tenant_admin không email → 400 EMAIL_REQUIRED; member không email → 201", async () => {
    expectErr(await create(binh, member("pho", { role: "tenant_admin" })), "EMAIL_REQUIRED");
    expect((await create(binh, member("pho2"))).status).toBe(201);
    const ok = await create(
      binh,
      member("pho3", { role: "tenant_admin", email: "pho3@acme.test" }),
    );
    expect(ok.status).toBe(201);
  });

  it("ADM-FR-04 · M1-R10 · tạo ở tenant khoá (zeta, bởi platform_admin) → 201, locked_by_tenant=true, status locked", async () => {
    const res = await create(admin, member("nam"), `?tenant_id=${TENANT_ID.zeta}`);
    expect(res.status).toBe(201);
    const u = UserCreateResponseSchema.parse(res.json).user;
    expect([u.locked_by_tenant, u.status, u.active]).toEqual([true, "locked", true]);
  });

  it("ADM-FR-04 · M1-R15 · username chuẩn hoá chữ thường; 33 ký tự/ký tự lạ → 400; display_name trống/65 ký tự, trường lạ → 400", async () => {
    const res = await create(binh, member("NamNguyen"));
    expect(res.status).toBe(201);
    expect(UserCreateResponseSchema.parse(res.json).user.username).toBe("namnguyen");
    const bad = [
      member("n".repeat(33)),
      member("na m"),
      member("na@m"),
      member("ok1", { display_name: "" }),
      member("ok2", { display_name: "d".repeat(65) }),
      member("ok3", { extra: 1 }),
    ];
    for (const body of bad) expectErr(await create(binh, body), "VALIDATION_ERROR");
  });
});

describe("ADM-FR-04 · xem và sửa user", () => {
  it("ADM-FR-04 · M1-R19 · GET /:an → 200; PATCH display_name → 200 version+1; version cũ → 409 VERSION_CONFLICT {current: User}", async () => {
    const before = await getUser(binh, USER_ID.an);
    const res = await patch(binh, USER_ID.an, { version: before.version, display_name: "An Moi" });
    expect(res.status).toBe(200);
    const after = UserSchema.parse(res.json);
    expect([after.version, after.display_name]).toEqual([before.version + 1, "An Moi"]);
    const stale = await patch(binh, USER_ID.an, { version: before.version, display_name: "Khac" });
    expectErr(stale, "VERSION_CONFLICT");
    const d = versionConflictDetailsSchema("user").parse(stale.json.error.details);
    expect(d.current.display_name).toBe("An Moi");
    expect(d.updated_at).toBe(d.current.updated_at);
  });

  it("ADM-FR-04 · M1-R15 · body có `username` → 400 VALIDATION_ERROR", async () => {
    expectErr(await patch(binh, USER_ID.an, { version: 1, username: "moi" }), "VALIDATION_ERROR");
  });

  it("ADM-FR-04 · M1-R16 · email:null: member ok; tenant_admin → 400 EMAIL_REQUIRED; member→tenant_admin cần email", async () => {
    const lan = await getUser(binh, USER_ID.lan);
    expect((await patch(binh, USER_ID.lan, { version: lan.version, email: null })).status).toBe(
      200,
    );
    expectErr(await patch(binh, USER_ID.chi, { version: 1, email: null }), "EMAIL_REQUIRED");
    expectErr(
      await patch(binh, USER_ID.an, { version: 1, role: "tenant_admin" }),
      "EMAIL_REQUIRED",
    );
    const ok = await patch(binh, USER_ID.an, {
      version: 1,
      role: "tenant_admin",
      email: "an@acme.test",
    });
    expect(ok.status).toBe(200);
    expect(UserSchema.parse(ok.json).role).toBe("tenant_admin");
  });

  it("ADM-FR-04 · M1-R16 · đổi sang email đã dùng trong tenant → 409 EMAIL_TAKEN", async () => {
    expectErr(await patch(binh, USER_ID.an, { version: 1, email: "LAN@acme.test" }), "EMAIL_TAKEN");
  });

  it("ADM-BR-08 · M1-R11 · binh tự đổi role → 403 SELF_ACTION_FORBIDDEN; binh hạ chi → 200 (acme còn binh)", async () => {
    expectErr(
      await patch(binh, USER_ID.binh, { version: 1, role: "member" }),
      "SELF_ACTION_FORBIDDEN",
    );
    const res = await patch(binh, USER_ID.chi, { version: 1, role: "member" });
    expect(res.status).toBe(200);
    expect(UserSchema.parse(res.json).role).toBe("member");
  });

  it("ADM-BR-05 · M1-R12 · admin đổi role admin2 → 400 ROLE_NOT_ALLOWED; admin đặt an thành platform_admin → 400 ROLE_NOT_ALLOWED", async () => {
    expectErr(
      await patch(admin, USER_ID.admin2, { version: 1, role: "member" }),
      "ROLE_NOT_ALLOWED",
    );
    expectErr(
      await patch(admin, USER_ID.an, { version: 1, role: "platform_admin" }),
      "ROLE_NOT_ALLOWED",
    );
  });

  it("ADM-FR-04 · spec §3 · đăng nhập/failed_logins không làm version đổi", async () => {
    const before = await getUser(binh, USER_ID.an);
    await wrongLogins(env, "acme", "an", 3);
    await env.login("acme", "an", PW);
    expect((await getUser(binh, USER_ID.an)).version).toBe(before.version);
  });
});

describe("ADM-FR-05 · khoá, mở khoá, đăng xuất mọi thiết bị", () => {
  it("ADM-FR-05 · AC-A02 · binh lock an → 200 active=false status locked; token user_locked; đăng nhập đúng → 403 ACCOUNT_LOCKED; idempotent (version không đổi)", async () => {
    await env.session("acme", "an", PW);
    const res = await act(binh, USER_ID.an, "lock");
    expect(res.status).toBe(200);
    const u = UserSchema.parse(res.json);
    expect([u.active, u.status]).toEqual([false, "locked"]);
    expect(new Set(await revokedReasons(USER_ID.an))).toEqual(new Set(["user_locked"]));
    expectErr(await env.login("acme", "an", PW), "ACCOUNT_LOCKED");
    const again = await act(binh, USER_ID.an, "lock");
    expect(again.status).toBe(200);
    expect(UserSchema.parse(again.json).version).toBe(u.version);
  });

  it("ADM-FR-05 · M1-R09 · unlock an → active=true; khoá tạm bị xoá nên đăng nhập được ngay", async () => {
    await wrongLogins(env, "acme", "lan", 5);
    await act(binh, USER_ID.lan, "lock");
    const res = await act(binh, USER_ID.lan, "unlock");
    expect(res.status).toBe(200);
    expect(UserSchema.parse(res.json).active).toBe(true);
    const r = await userRow(USER_ID.lan);
    expect([r?.failed_logins, r?.locked_until]).toEqual([0, null]);
    expect((await env.login("acme", "lan", PW)).status).toBe(200);
  });

  it("ADM-FR-05 · M1-R10 · unlock không gỡ locked_by_tenant: lock rồi unlock zed (tenant zeta khoá) → vẫn status locked, đăng nhập 403", async () => {
    expect((await act(admin, USER_ID.zed, "lock")).status).toBe(200);
    const res = await act(admin, USER_ID.zed, "unlock");
    const u = UserSchema.parse(res.json);
    expect([u.active, u.locked_by_tenant, u.status]).toEqual([true, true, "locked"]);
    expectErr(await env.login("zeta", "zed", PW), "ACCOUNT_LOCKED");
  });

  it("ADM-FR-05 · M1-R09 · logout-all → 204: mọi refresh token logout_all, active giữ nguyên, access token đã cấp vẫn dùng được", async () => {
    const s = await env.session("acme", "an", PW);
    await env.session("acme", "an", PW);
    const res = await act(binh, USER_ID.an, "logout-all");
    expect(res.status).toBe(204);
    expect(new Set(await revokedReasons(USER_ID.an))).toEqual(new Set(["logout_all"]));
    expect((await userRow(USER_ID.an))?.active).toBe(true);
    expect((await env.get("/auth/me", { token: s.token })).status).toBe(200);
  });
});

describe("ADM-FR-04 · reset mật khẩu", () => {
  it("ADM-FR-04 · M1-R17 · binh reset an → 200 {temp_password}; must_change_password; mật khẩu cũ 401, tạm → password_change_required; token password_reset; bộ đếm về 0", async () => {
    await env.session("acme", "an", PW);
    await env.owner`update admin.users set failed_logins = 3, locked_until = '2026-10-01T09:30:00Z'
      where id = ${USER_ID.an}`;
    const res = await act(binh, USER_ID.an, "reset-password");
    expect(res.status).toBe(200);
    const { temp_password } = TempPasswordResponseSchema.parse(res.json);
    const r = await userRow(USER_ID.an);
    expect([r?.must_change_password, r?.failed_logins, r?.locked_until]).toEqual([true, 0, null]);
    expectErr(await env.login("acme", "an", PW), "INVALID_CREDENTIALS");
    expect((await env.login("acme", "an", temp_password)).json.status).toBe(
      "password_change_required",
    );
    expect(new Set(await revokedReasons(USER_ID.an))).toEqual(new Set(["password_reset"]));
  });

  it("ADM-FR-04 · M1-R17 · hai lần reset cho hai mật khẩu khác nhau; binh reset binh → 403 SELF_ACTION_FORBIDDEN", async () => {
    const a = TempPasswordResponseSchema.parse(
      (await act(binh, USER_ID.an, "reset-password")).json,
    );
    const b = TempPasswordResponseSchema.parse(
      (await act(binh, USER_ID.an, "reset-password")).json,
    );
    expect(a.temp_password).not.toBe(b.temp_password);
    expect(a.temp_password).not.toBe(TEMP_PW);
    expectErr(await act(binh, USER_ID.binh, "reset-password"), "SELF_ACTION_FORBIDDEN");
  });
});
