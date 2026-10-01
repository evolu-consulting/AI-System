// ADM-FR-60, ADM-FR-61, ADM-BR-09 · /admin/tenants* (test-plan A4; M1-AC03; M1-R10/R15/R18).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  TenantCreateResponseSchema,
  TenantDetailSchema,
  TenantListResponseSchema,
  TenantSchema,
  versionConflictDetailsSchema,
} from "@ai/contracts";
import { createEnv, type Env, expectErr, PW, TENANT_ID, UNKNOWN_ID, USER_ID } from "./_fixtures";

let env: Env;
let admin: string;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset();
  admin = await env.token("platform", "admin");
});

const list = async (qs = "") => {
  const res = await env.get(`/admin/tenants${qs}`, { token: admin });
  return { res, body: res.status === 200 ? TenantListResponseSchema.parse(res.json) : undefined };
};
const count = async (table: string) => {
  const [r] = await env.owner.unsafe(`select count(*)::int as n from admin.${table}`);
  return r?.n as number;
};
const newTenant = (over: Record<string, unknown> = {}) => ({
  key: "initech",
  name: "Initech",
  first_admin: {
    username: "lumbergh",
    display_name: "Bill Lumbergh",
    email: "bill@initech.test",
    locale: "en",
  },
  ...over,
});
const create = (body: unknown) => env.post("/admin/tenants", { token: admin, body });
const tenantRow = async (id: string) => {
  const [r] = await env.owner`select * from admin.tenants where id = ${id}`;
  return r;
};

describe("ADM-FR-60 · danh sách tenant", () => {
  it("ADM-FR-60 · M1-R19 · admin → 200 {items,total,counts}: 4 tenant sắp key tăng dần, user_count đúng", async () => {
    const { body } = await list();
    expect(body?.items.map((t) => t.key)).toEqual(["acme", "globex", "platform", "zeta"]);
    expect(body?.items.map((t) => t.user_count)).toEqual([7, 3, 2, 2]);
    expect(body?.total).toBe(4);
    expect(body?.counts).toEqual({ all: 4, active: 3, locked: 1 });
  });

  it("ADM-FR-60 · M1-R19 · q=ACM khớp key/name (ILIKE); status=locked → chỉ zeta; counts không đổi theo status", async () => {
    const q = await list("?q=ACM");
    expect(q.body?.items.map((t) => t.key)).toEqual(["acme"]);
    const byName = await list("?q=globe");
    expect(byName.body?.items.map((t) => t.key)).toEqual(["globex"]);
    const locked = await list("?status=locked");
    expect(locked.body?.items.map((t) => t.key)).toEqual(["zeta"]);
    expect(locked.body?.counts).toEqual({ all: 4, active: 3, locked: 1 });
  });

  it("ADM-FR-60 · M1-R19 · limit=1&offset=1 → 1 item, total=4", async () => {
    const { body } = await list("?limit=1&offset=1");
    expect(body?.items.map((t) => t.key)).toEqual(["globex"]);
    expect(body?.total).toBe(4);
  });

  it("ADM-FR-60 · M1-R19 · limit=0/201, offset=-1, tham số lạ → 400 VALIDATION_ERROR", async () => {
    for (const qs of ["?limit=0", "?limit=201", "?offset=-1", "?foo=1", "?status=weird"]) {
      expectErr((await list(qs)).res, "VALIDATION_ERROR");
    }
  });
});

describe("ADM-FR-60 · tạo tenant + tenant_admin đầu tiên", () => {
  it("ADM-FR-60 · M1-R17 · POST → 201 đúng schema, temp_password 16 ký tự, first_admin tenant_admin must_change_password, tenant active version 1", async () => {
    const res = await create(newTenant());
    expect(res.status).toBe(201);
    const b = TenantCreateResponseSchema.parse(res.json);
    expect(b.temp_password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(b.first_admin.role).toBe("tenant_admin");
    expect(b.first_admin.must_change_password).toBe(true);
    expect(b.first_admin.locale).toBe("en");
    expect(b.tenant.active).toBe(true);
    expect(b.tenant.version).toBe(1);
    expect(b.tenant.max_concurrent_sub).toBeNull();
    expect(b.tenant.key).toBe("initech");
  });

  it("ADM-FR-60 · M1-R17 · đăng nhập mã công ty mới + temp_password → password_change_required; mật khẩu chỉ ở DB dạng argon2id; hai lần tạo cho hai mật khẩu khác nhau", async () => {
    const a = TenantCreateResponseSchema.parse((await create(newTenant())).json);
    const login = await env.login("initech", "lumbergh", a.temp_password);
    expect(login.json.status).toBe("password_change_required");
    const [u] = await env.owner`select password_hash from admin.users where username = 'lumbergh'`;
    expect(u?.password_hash).toStartWith("$argon2id$");
    expect(u?.password_hash).not.toContain(a.temp_password);
    const b = TenantCreateResponseSchema.parse(
      (await create(newTenant({ key: "initech2", name: "Initech 2" }))).json,
    );
    expect(b.temp_password).not.toBe(a.temp_password);
  });

  it("ADM-FR-60 · M1-R15 · key trùng (kể cả 'ACME' viết hoa) → 409 KEY_TAKEN và không thêm hàng nào", async () => {
    const before = [await count("tenants"), await count("users")];
    for (const key of ["acme", "ACME"]) {
      expectErr(await create(newTenant({ key })), "KEY_TAKEN");
    }
    expect([await count("tenants"), await count("users")]).toEqual(before);
  });

  it("ADM-FR-60 · M1-R18 · dữ liệu sai → 400 VALIDATION_ERROR và không tạo tenant nửa vời", async () => {
    const fa = newTenant().first_admin;
    const bad: unknown[] = [
      newTenant({ key: "a" }),
      newTenant({ key: "A_b" }),
      newTenant({ key: "k".repeat(33) }),
      newTenant({ max_concurrent_sub: 0 }),
      newTenant({ max_concurrent_sub: 10001 }),
      newTenant({ max_concurrent_sub: 1.5 }),
      newTenant({ first_admin: { ...fa, email: undefined } }),
      newTenant({ first_admin: { ...fa, email: "khong-hop-le" } }),
      newTenant({ first_admin: { ...fa, username: "Sai Ten!" } }),
      newTenant({ extra: true }),
    ];
    const before = [await count("tenants"), await count("users")];
    for (const body of bad) expectErr(await create(body), "VALIDATION_ERROR");
    expect([await count("tenants"), await count("users")]).toEqual(before);
  });
});

describe("ADM-FR-60 · xem và sửa tenant", () => {
  it("ADM-FR-60 · M1-R19 · GET /:id → TenantDetail với stats (acme: 7/2/1); id lạ hoặc không phải uuid → 404 NOT_FOUND", async () => {
    const res = await env.get(`/admin/tenants/${TENANT_ID.acme}`, { token: admin });
    expect(res.status).toBe(200);
    const d = TenantDetailSchema.parse(res.json);
    expect(d.stats).toEqual({ user_count: 7, tenant_admin_count: 2, locked_user_count: 1 });
    for (const id of [UNKNOWN_ID, "abc"]) {
      expectErr(await env.get(`/admin/tenants/${id}`, { token: admin }), "NOT_FOUND");
    }
  });

  it("ADM-FR-60 · M1-R19 · PATCH {version:1,name} → 200, version 2, updated_at đổi", async () => {
    const before = await tenantRow(TENANT_ID.acme);
    const res = await env.patch(`/admin/tenants/${TENANT_ID.acme}`, {
      token: admin,
      body: { version: 1, name: "Acme Renamed" },
    });
    expect(res.status).toBe(200);
    const t = TenantSchema.parse(res.json);
    expect(t.version).toBe(2);
    expect(t.name).toBe("Acme Renamed");
    expect(new Date(t.updated_at).getTime()).toBeGreaterThan(
      new Date(before?.updated_at).getTime(),
    );
  });

  it("ADM-FR-60 · M1-R19 · version cũ → 409 VERSION_CONFLICT với details {current, updated_at} khớp bản mới nhất", async () => {
    const path = `/admin/tenants/${TENANT_ID.acme}`;
    await env.patch(path, { token: admin, body: { version: 1, name: "Acme Renamed" } });
    const res = await env.patch(path, { token: admin, body: { version: 1, name: "Khac" } });
    expectErr(res, "VERSION_CONFLICT");
    const d = versionConflictDetailsSchema("tenant").parse(res.json.error.details);
    expect(d.current.version).toBe(2);
    expect(d.current.name).toBe("Acme Renamed");
    expect(d.updated_at).toBe(d.current.updated_at);
  });

  it("ADM-FR-60 · M1-R15 · body có `key` → 400; max_concurrent_sub:null xoá giới hạn", async () => {
    const path = `/admin/tenants/${TENANT_ID.acme}`;
    expectErr(
      await env.patch(path, { token: admin, body: { version: 1, key: "moi" } }),
      "VALIDATION_ERROR",
    );
    const res = await env.patch(path, {
      token: admin,
      body: { version: 1, max_concurrent_sub: null },
    });
    expect(res.status).toBe(200);
    expect(TenantSchema.parse(res.json).max_concurrent_sub).toBeNull();
    expect((await tenantRow(TENANT_ID.acme))?.key).toBe("acme");
  });
});

describe("ADM-FR-61 · M1-AC03 · khoá tenant", () => {
  const lock = (id: string) => env.post(`/admin/tenants/${id}/lock`, { token: admin });
  const unlock = (id: string) => env.post(`/admin/tenants/${id}/unlock`, { token: admin });

  it("ADM-FR-61 · M1-R10 · lock acme → 200 active=false status locked; user active có locked_by_tenant, em không đổi; token tenant_locked; tenant khác không đổi", async () => {
    const s = await env.session("acme", "an", PW);
    const res = await lock(TENANT_ID.acme);
    expect(res.status).toBe(200);
    const t = TenantSchema.parse(res.json);
    expect([t.active, t.status]).toEqual([false, "locked"]);
    const users = await env.owner`select username, active, locked_by_tenant from admin.users
      where tenant_id = ${TENANT_ID.acme}`;
    for (const u of users) {
      expect(u.locked_by_tenant).toBe(u.username !== "em");
    }
    const tokens = await env.owner`select revoked_reason from admin.refresh_tokens
      where tenant_id = ${TENANT_ID.acme}`;
    expect(tokens.length).toBeGreaterThan(0);
    for (const r of tokens) expect(r.revoked_reason).toBe("tenant_locked");
    expect((await tenantRow(TENANT_ID.globex))?.active).toBe(true);
    const [g] = await env.owner`select count(*)::int as n from admin.users
      where tenant_id = ${TENANT_ID.globex} and locked_by_tenant`;
    expect(g?.n).toBe(0);
    expectErr(await env.post("/auth/refresh", { cookie: s.cookie }), "INVALID_REFRESH_TOKEN");
  });

  it("ADM-FR-61 · M1-AC03 · sau khoá: an đúng mật khẩu → 403 ACCOUNT_LOCKED, sai → 401; access token cũ → 401 UNAUTHORIZED", async () => {
    const s = await env.session("acme", "an", PW);
    await lock(TENANT_ID.acme);
    expectErr(await env.login("acme", "an", PW), "ACCOUNT_LOCKED");
    expectErr(await env.login("acme", "an", "sai-mat-khau-1"), "INVALID_CREDENTIALS");
    expectErr(await env.get("/auth/me", { token: s.token }), "UNAUTHORIZED");
  });

  it("ADM-FR-61 · M1-R10 · lock idempotent: lần 2 → 200, version không đổi", async () => {
    const first = TenantSchema.parse((await lock(TENANT_ID.acme)).json);
    const again = await lock(TENANT_ID.acme);
    expect(again.status).toBe(200);
    expect(TenantSchema.parse(again.json).version).toBe(first.version);
  });

  it("ADM-FR-61 · M1-AC03 · unlock acme → active; gỡ locked_by_tenant; an đăng nhập lại được; em (khoá riêng) vẫn 403; idempotent", async () => {
    await lock(TENANT_ID.acme);
    const res = await unlock(TENANT_ID.acme);
    expect(res.status).toBe(200);
    const t = TenantSchema.parse(res.json);
    expect([t.active, t.status]).toEqual([true, "active"]);
    const [left] = await env.owner`select count(*)::int as n from admin.users
      where tenant_id = ${TENANT_ID.acme} and locked_by_tenant`;
    expect(left?.n).toBe(0);
    expect((await env.login("acme", "an", PW)).status).toBe(200);
    expectErr(await env.login("acme", "em", PW), "ACCOUNT_LOCKED");
    const again = await unlock(TENANT_ID.acme);
    expect(TenantSchema.parse(again.json).version).toBe(t.version);
  });

  it("ADM-FR-61 · M1-R10 · lock platform → 409 PLATFORM_TENANT_LOCKED, DB không đổi; lock/unlock id lạ → 404", async () => {
    const [p] =
      await env.owner`select id, version, active from admin.tenants where key = 'platform'`;
    expectErr(await lock(p?.id), "PLATFORM_TENANT_LOCKED");
    const after = await tenantRow(p?.id);
    expect([after?.active, after?.version]).toEqual([true, p?.version]);
    expectErr(await lock(UNKNOWN_ID), "NOT_FOUND");
    expectErr(await unlock(UNKNOWN_ID), "NOT_FOUND");
    expectErr(await lock("abc"), "NOT_FOUND");
  });
});

describe("ADM-BR-05 · ADM-BR-09 · phân quyền tenants", () => {
  it("ADM-BR-05 · M1-R12 · tenant_admin và member gọi mọi endpoint /admin/tenants* → 403 FORBIDDEN (kể cả id lạ, body sai)", async () => {
    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/admin/tenants"],
      ["POST", "/admin/tenants", { sai: true }],
      ["GET", `/admin/tenants/${UNKNOWN_ID}`],
      ["PATCH", `/admin/tenants/${UNKNOWN_ID}`, { sai: true }],
      ["POST", `/admin/tenants/${UNKNOWN_ID}/lock`],
      ["POST", `/admin/tenants/${UNKNOWN_ID}/unlock`],
    ];
    for (const who of ["binh", "an"]) {
      const token = await env.token("acme", who);
      for (const [m, p, body] of calls)
        expectErr(await env.call(m, p, { token, body }), "FORBIDDEN");
    }
  });

  it("ADM-BR-05 · M1-R12 · không Bearer → 401 UNAUTHORIZED", async () => {
    expectErr(await env.get("/admin/tenants"), "UNAUTHORIZED");
    expectErr(await env.post("/admin/tenants", { body: newTenant() }), "UNAUTHORIZED");
  });

  it("ADM-FR-60 · M1-R18 · tenant_admin đầu tiên là hàng users thật: username lumbergh thuộc tenant mới, không thuộc acme", async () => {
    const b = TenantCreateResponseSchema.parse((await create(newTenant())).json);
    const rows = await env.owner`select tenant_id from admin.users where username = 'lumbergh'`;
    expect(rows.map((r) => r.tenant_id)).toEqual([b.tenant.id]);
    expect(b.first_admin.id).not.toBe(USER_ID.binh);
  });
});
