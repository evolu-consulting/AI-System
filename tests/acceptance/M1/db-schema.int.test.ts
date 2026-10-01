// ADM-NFR-06, ADM-FR-63, ADM-BR-05 · schema admin, ràng buộc, chỉ mục, migration (test-plan D2).
// Chỉ dùng owner + resetTestDb + runMigrations: không seed, không app, không import _fixtures.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";

const URL = process.env.TEST_DATABASE_URL;
if (!URL)
  throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev` rồi `bun run test:int`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });

const T1 = "01900000-0000-7000-8000-000000000001";
const T2 = "01900000-0000-7000-8000-000000000002";
const U1 = "01900000-0000-7000-8000-000000000011";
let firstRun: { main: number; dev: number };
let secondRun: { main: number; dev: number };

type PgFail = { code: string | null; constraint: string | null };
/** Lệnh thành công → null; lỗi → {SQLSTATE, tên constraint}. */
async function fail(q: PromiseLike<unknown>): Promise<PgFail | null> {
  try {
    await q;
    return null;
  } catch (e) {
    const err = e as { code?: string; constraint_name?: string };
    return { code: err.code ?? null, constraint: err.constraint_name ?? null };
  }
}
const tenant = (id: string, key: string, name = "Name", extra = "") =>
  sql.unsafe(`insert into admin.tenants (id, key, name ${extra ? `, ${extra.split("=")[0]}` : ""})
    values ('${id}', '${key}', '${name}' ${extra ? `, ${extra.split("=")[1]}` : ""})`);
const user = (id: string, tid: string, username: string, more: Record<string, string> = {}) => {
  const cols = {
    id,
    tenant_id: tid,
    username,
    password_hash: "h",
    display_name: "D",
    role: "member",
    ...more,
  };
  const names = Object.keys(cols).join(", ");
  const vals = Object.values(cols)
    .map((v) => (v === "NULL" ? "NULL" : `'${v}'`))
    .join(", ");
  return sql.unsafe(`insert into admin.users (${names}) values (${vals})`);
};
const names = async (schemas: string[]) =>
  (
    await sql<
      { t: string }[]
    >`select table_schema || '.' || table_name as t from information_schema.tables
      where table_schema in ${sql(schemas)} and table_type = 'BASE TABLE' order by 1`
  ).map((r) => r.t);
const clean = () =>
  sql`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features cascade`;

beforeAll(async () => {
  await resetTestDb(URL);
  firstRun = await runMigrations({ url: URL, appEnv: "development" });
  secondRun = await runMigrations({ url: URL, appEnv: "development" });
});
afterAll(async () => {
  await sql.end();
});

describe("ADM-NFR-06 · migration development", () => {
  it("ADM-NFR-06 · spec §4 · development: {main:3, dev:2}; lần 2 {0,0}", () => {
    expect(firstRun).toEqual({ main: 3, dev: 2 });
    expect(secondRun).toEqual({ main: 0, dev: 0 });
  });

  it("ADM-NFR-06 · spec §4 · đúng 4 bảng admin.* và 3 bảng hub.*; không có bảng/cột của mốc sau", async () => {
    expect(await names(["admin", "hub"])).toEqual([
      "admin.features",
      "admin.refresh_tokens",
      "admin.tenants",
      "admin.users",
      "hub.agent_grants",
      "hub.agent_workflows",
      "hub.usage_logs",
    ]);
    const [later] = await sql`select count(*)::int as n from information_schema.tables
      where table_schema = 'admin' and table_name in ('groups', 'group_members', 'config_meta',
        'secrets', 'workflows', 'commands', 'tenant_quotas', 'audit_log')`;
    expect(later?.n).toBe(0);
    const [totp] = await sql`select count(*)::int as n from information_schema.columns
      where table_schema = 'admin' and table_name = 'users' and column_name = 'totp_secret'`;
    expect(totp?.n).toBe(0);
  });

  it("ADM-NFR-06 · spec §4 · chỉ mục tồn tại theo pg_indexes", async () => {
    const rows = await sql<
      { indexname: string }[]
    >`select indexname from pg_indexes where schemaname = 'admin'`;
    const have = rows.map((r) => r.indexname);
    for (const n of [
      "users_tenant_role_active_idx",
      "users_username_idx",
      "refresh_tokens_user_active_idx",
      "refresh_tokens_tenant_active_idx",
      "refresh_tokens_family_idx",
      "refresh_tokens_hash_uq",
    ]) {
      expect(have).toContain(n);
    }
  });
});

describe("ADM-FR-63 · ràng buộc tenants", () => {
  it("ADM-NFR-06 · spec §4 · tenants: key trùng → 23505 tenants_key_uq; key sai (A, a, a_b) → 23514", async () => {
    await clean();
    await tenant(T1, "acme");
    const dup = await fail(tenant(T2, "acme"));
    expect(dup).toEqual({ code: "23505", constraint: "tenants_key_uq" });
    for (const key of ["A", "a", "a_b"]) {
      expect((await fail(tenant(T2, key)))?.code).toBe("23514");
    }
    expect(await fail(tenant(T2, "ab"))).toBeNull();
  });

  it("ADM-NFR-06 · spec §4 · tenants: name rỗng/129 ký tự và max_concurrent_sub 0/10001 → 23514; biên 1 và 10000 ok", async () => {
    await clean();
    expect((await fail(tenant(T1, "t-empty", "")))?.code).toBe("23514");
    expect((await fail(tenant(T1, "t-long", "n".repeat(129))))?.code).toBe("23514");
    expect((await fail(tenant(T1, "t-zero", "N", "max_concurrent_sub=0")))?.code).toBe("23514");
    expect((await fail(tenant(T1, "t-big", "N", "max_concurrent_sub=10001")))?.code).toBe("23514");
    expect(await fail(tenant(T1, "t-lo", "N", "max_concurrent_sub=1"))).toBeNull();
    expect(await fail(tenant(T2, "t-hi", "N", "max_concurrent_sub=10000"))).toBeNull();
  });
});

describe("ADM-FR-63 · ràng buộc users", () => {
  it("ADM-FR-63 · spec §4 · username trùng trong tenant → 23505 users_tenant_username_uq; cùng username khác tenant được", async () => {
    await clean();
    await tenant(T1, "acme");
    await tenant(T2, "globex");
    await user(U1, T1, "an");
    const dup = await fail(user("01900000-0000-7000-8000-000000000012", T1, "an"));
    expect(dup).toEqual({ code: "23505", constraint: "users_tenant_username_uq" });
    expect(await fail(user("01900000-0000-7000-8000-000000000013", T2, "an"))).toBeNull();
  });

  it("ADM-NFR-06 · spec §4 · email: trùng không phân biệt hoa thường → 23505 users_tenant_email_uq; nhiều email NULL được phép", async () => {
    await clean();
    await tenant(T1, "acme");
    await user(U1, T1, "u1", { email: "Foo@x.test" });
    const dup = await fail(
      user("01900000-0000-7000-8000-000000000012", T1, "u2", { email: "foo@X.test" }),
    );
    expect(dup).toEqual({ code: "23505", constraint: "users_tenant_email_uq" });
    expect(await fail(user("01900000-0000-7000-8000-000000000013", T1, "u3"))).toBeNull();
    expect(await fail(user("01900000-0000-7000-8000-000000000014", T1, "u4"))).toBeNull();
  });

  it("ADM-BR-05 · spec §4 · CHECK: role lạ, tenant_admin không email, locale 'fr', failed_logins < 0, username sai → 23514", async () => {
    await clean();
    await tenant(T1, "acme");
    const id = (n: number) => `01900000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;
    expect((await fail(user(id(1), T1, "r1", { role: "superuser" })))?.code).toBe("23514");
    expect((await fail(user(id(2), T1, "r2", { role: "tenant_admin" })))?.code).toBe("23514");
    expect(
      await fail(user(id(3), T1, "r3", { role: "tenant_admin", email: "a@x.test" })),
    ).toBeNull();
    expect((await fail(user(id(4), T1, "r4", { locale: "fr" })))?.code).toBe("23514");
    expect((await fail(user(id(5), T1, "r5", { failed_logins: "-1" })))?.code).toBe("23514");
    expect((await fail(user(id(6), T1, "R6")))?.code).toBe("23514");
    expect((await fail(user(id(7), T1, "r7", { display_name: "" })))?.code).toBe("23514");
  });

  it("ADM-NFR-06 · spec §4 · FK users.tenant_id RESTRICT: xoá tenant còn user → 23503", async () => {
    await clean();
    await tenant(T1, "acme");
    await user(U1, T1, "an");
    expect((await fail(sql`delete from admin.tenants where id = ${T1}`))?.code).toBe("23503");
  });

  it("ADM-NFR-06 · spec §4 · giá trị mặc định cột users/tenants", async () => {
    await clean();
    await tenant(T1, "acme");
    await user(U1, T1, "an");
    const [u] =
      await sql`select must_change_password, locale, active, locked_by_tenant, failed_logins, version
      from admin.users where id = ${U1}`;
    expect(u).toEqual({
      must_change_password: true,
      locale: "vi",
      active: true,
      locked_by_tenant: false,
      failed_logins: 0,
      version: 1,
    });
    const [t] = await sql`select settings, version, active from admin.tenants where id = ${T1}`;
    expect(t).toEqual({ settings: {}, version: 1, active: true });
  });
});

describe("ADM-NFR-01 · ràng buộc refresh_tokens và features", () => {
  const rt = (over: Record<string, string>) => {
    const cols = {
      id: "01900000-0000-7000-8000-0000000002aa",
      user_id: U1,
      tenant_id: T1,
      family_id: "01900000-0000-7000-8000-0000000002aa",
      client: "web",
      expires_at: "2027-01-01T00:00:00Z",
      ...over,
    };
    const hash = (over.hashhex ?? "ab".repeat(32)).replace(/^/, "\\x");
    const { hashhex: _drop, ...rest } = cols as Record<string, string>;
    const names = [...Object.keys(rest), "token_hash"].join(", ");
    const vals = [
      ...Object.values(rest).map((v) => (v === "NULL" ? "NULL" : `'${v}'`)),
      `'${hash}'`,
    ].join(", ");
    return sql.unsafe(`insert into admin.refresh_tokens (${names}) values (${vals})`);
  };
  const prepare = async () => {
    await clean();
    await tenant(T1, "acme");
    await user(U1, T1, "an");
  };

  it("ADM-NFR-01 · spec §4 · token_hash 31 byte → 23514; trùng → 23505 refresh_tokens_hash_uq", async () => {
    await prepare();
    expect((await fail(rt({ hashhex: "ab".repeat(31) })))?.code).toBe("23514");
    expect(await fail(rt({}))).toBeNull();
    const dup = await fail(
      rt({
        id: "01900000-0000-7000-8000-0000000002ab",
        family_id: "01900000-0000-7000-8000-0000000002ab",
      }),
    );
    expect(dup).toEqual({ code: "23505", constraint: "refresh_tokens_hash_uq" });
  });

  it("ADM-NFR-01 · spec §4 · client lạ → 23514; revoked_at và revoked_reason phải cùng null/không null; lý do lạ → 23514", async () => {
    await prepare();
    expect((await fail(rt({ client: "mobile" })))?.code).toBe("23514");
    expect((await fail(rt({ revoked_at: "2026-10-01T00:00:00Z" })))?.code).toBe("23514");
    expect((await fail(rt({ revoked_reason: "logout" })))?.code).toBe("23514");
    const bad = rt({ revoked_at: "2026-10-01T00:00:00Z", revoked_reason: "weird" });
    expect((await fail(bad))?.code).toBe("23514");
    const ok = rt({ revoked_at: "2026-10-01T00:00:00Z", revoked_reason: "logout" });
    expect(await fail(ok)).toBeNull();
  });

  it("ADM-NFR-01 · spec §4 · xoá user CASCADE xoá refresh token", async () => {
    await prepare();
    await rt({});
    await sql`delete from admin.users where id = ${U1}`;
    const [n] = await sql`select count(*)::int as n from admin.refresh_tokens`;
    expect(n?.n).toBe(0);
  });

  it("ADM-NFR-06 · spec §4 · features: key sai và status lạ → 23514; hợp lệ ok", async () => {
    await clean();
    expect((await fail(sql`insert into admin.features (key, name) values ('A', '{}')`))?.code).toBe(
      "23514",
    );
    expect(
      (await fail(sql`insert into admin.features (key, name, status) values ('ok', '{}', 'maybe')`))
        ?.code,
    ).toBe("23514");
    expect(
      await fail(sql`insert into admin.features (key, name, status) values ('ok', '{}', 'beta')`),
    ).toBeNull();
  });
});

describe("ADM-NFR-06 · migration production", () => {
  it("ADM-NFR-06 · spec §4 · production: {main:3, dev:0}; 4 bảng admin.*, 0 bảng hub.*; không có bảng theo dõi dev", async () => {
    await resetTestDb(URL);
    const r = await runMigrations({ url: URL, appEnv: "production" });
    expect(r).toEqual({ main: 3, dev: 0 });
    expect(await names(["admin", "hub"])).toEqual([
      "admin.features",
      "admin.refresh_tokens",
      "admin.tenants",
      "admin.users",
    ]);
    const [dev] = await sql<
      { r: string | null }[]
    >`select to_regclass('drizzle.__drizzle_migrations_dev')::text as r`;
    expect(dev?.r).toBeNull();
  });
});
