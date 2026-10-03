// ADM-NFR-07, ADM-BR-09 · RLS thật, truy vấn trực tiếp bằng role admin_api (test-plan D1; M1-AC02).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  insertRefresh,
  insertUsers,
  type Sql,
  sha256,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: Env;
let api: Sql;
const tokens: Record<"acme" | "globex", Awaited<ReturnType<typeof insertRefresh>> | undefined> = {
  acme: undefined,
  globex: undefined,
};

beforeAll(async () => {
  env = await createEnv();
  api = postgres(ADMIN_API_URL, { max: 1, onnotice: () => {} });
  tokens.acme = await insertRefresh(env.owner, { userId: USER_ID.an, tenantId: TENANT_ID.acme });
  tokens.globex = await insertRefresh(env.owner, {
    userId: USER_ID.hoa,
    tenantId: TENANT_ID.globex,
  });
});
afterAll(async () => {
  await api.end();
  await env.close();
});

type Tx = postgres.TransactionSql;
class Rollback extends Error {}

/** Chạy `fn` trong transaction đã đặt scope, luôn rollback (không để lại thay đổi). */
async function scoped<T>(
  sql: Sql,
  scope: string | null,
  tenantId: string | null,
  fn: (tx: Tx) => Promise<T>,
  role?: string,
): Promise<T> {
  let out: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (role) await tx.unsafe(`set local role ${role}`);
      if (scope !== null) {
        await tx`select set_config('app.scope', ${scope}, true), set_config('app.tenant_id', ${tenantId ?? ""}, true)`;
      }
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}

/** SQLSTATE của lệnh lỗi, hoặc null nếu lệnh chạy được. */
const sqlState = async (q: PromiseLike<unknown>): Promise<string | null> => {
  try {
    await q;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
};
const countOf = async (tx: Tx, table: string): Promise<number> => {
  const [r] = await tx.unsafe(`select count(*)::int as n from admin.${table}`);
  return r?.n as number;
};

describe("ADM-NFR-07 · RLS theo app.scope/app.tenant_id", () => {
  it("ADM-NFR-07 · spec §4 · không đặt scope → users, tenants, refresh_tokens đều 0 hàng", async () => {
    const counts = await scoped(api, null, null, async (tx) => [
      await countOf(tx, "users"),
      await countOf(tx, "tenants"),
      await countOf(tx, "refresh_tokens"),
    ]);
    expect(counts).toEqual([0, 0, 0]);
  });

  it("ADM-NFR-07 · M1-AC02 · scope tenant=acme, select * from admin.users không WHERE → chỉ user acme (7); tenants chỉ acme; refresh_tokens chỉ acme", async () => {
    const r = await scoped(api, "tenant", TENANT_ID.acme, async (tx) => ({
      users: await tx`select * from admin.users`,
      tenants: await tx`select * from admin.tenants`,
      tokens: await tx`select * from admin.refresh_tokens`,
    }));
    expect(r.users).toHaveLength(7);
    expect(new Set(r.users.map((u) => u.tenant_id))).toEqual(new Set([TENANT_ID.acme]));
    expect(r.tenants.map((t) => t.key)).toEqual(["acme"]);
    expect(r.tokens.map((t) => t.tenant_id)).toEqual([TENANT_ID.acme]);
  });

  it("ADM-NFR-07 · M1-AC02 · lặp với SET LOCAL ROLE admin_rw từ owner: select * from admin.users không WHERE → chỉ user acme", async () => {
    const rows = await scoped(
      env.owner,
      "tenant",
      TENANT_ID.acme,
      (tx) => tx`select tenant_id from admin.users`,
      "admin_rw",
    );
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((u) => u.tenant_id))).toEqual(new Set([TENANT_ID.acme]));
  });

  it("ADM-NFR-07 · ADM-BR-09 · cô lập ghi: update/delete hàng tenant khác → 0 hàng; insert tenant khác → 42501", async () => {
    const r = await scoped(api, "tenant", TENANT_ID.acme, async (tx) => ({
      upd: await tx`update admin.users set display_name = 'x' where tenant_id = ${TENANT_ID.globex} returning id`,
      del: await tx`delete from admin.users where tenant_id = ${TENANT_ID.globex} returning id`,
      tenantUpd:
        await tx`update admin.tenants set name = 'x' where id = ${TENANT_ID.globex} returning id`,
    }));
    expect([r.upd.length, r.del.length, r.tenantUpd.length]).toEqual([0, 0, 0]);
    const insertOther = await scoped(api, "tenant", TENANT_ID.acme, (tx) =>
      sqlState(tx`insert into admin.users (tenant_id, username, password_hash, display_name, role)
        values (${TENANT_ID.globex}, 'x1', 'h', 'X', 'member')`),
    );
    expect(insertOther).toBe("42501");
    const insertTenant = await scoped(api, "tenant", TENANT_ID.acme, (tx) =>
      sqlState(tx`insert into admin.tenants (key, name) values ('moi', 'Moi')`),
    );
    expect(insertTenant).toBe("42501");
  });

  it("ADM-NFR-07 · spec §4 · scope platform → thấy cả 4 tenant, 14 user; ghi được mọi tenant", async () => {
    const r = await scoped(api, "platform", null, async (tx) => ({
      tenants: await countOf(tx, "tenants"),
      users: await countOf(tx, "users"),
      upd: await tx`update admin.users set display_name = 'x' where tenant_id = ${TENANT_ID.globex} returning id`,
    }));
    expect([r.tenants, r.users, r.upd.length]).toEqual([4, 14, 3]);
  });

  it("ADM-NFR-07 · spec §4 · app.tenant_id rỗng/không phải uuid, app.scope lạ → không rò dữ liệu", async () => {
    for (const tid of ["", "abc"]) {
      const r = await scoped(api, "tenant", tid, async (tx) => sqlState(countOf(tx, "users")));
      const n = r === null ? await scoped(api, "tenant", tid, (tx) => countOf(tx, "users")) : 0;
      expect(n).toBe(0);
    }
    const odd = await scoped(api, "x", TENANT_ID.acme, async (tx) => countOf(tx, "users"));
    expect(odd).toBe(0);
  });

  it("ADM-NFR-07 · spec §4 · không rò giữa transaction trên cùng kết nối; rollback không giữ scope", async () => {
    const first = await scoped(api, "tenant", TENANT_ID.acme, (tx) => countOf(tx, "users"));
    expect(first).toBe(7);
    const second = await scoped(api, null, null, (tx) => countOf(tx, "users"));
    expect(second).toBe(0);
    const third = await scoped(api, "platform", null, (tx) => countOf(tx, "users"));
    expect(third).toBe(14);
    const fourth = await scoped(api, null, null, (tx) => countOf(tx, "users"));
    expect(fourth).toBe(0);
  });
});

describe("ADM-NFR-07 · hàm SECURITY DEFINER", () => {
  it("ADM-NFR-07 · spec §4 · admin_api gọi tenant_id_by_key / tenant_id_by_refresh_hash không cần scope; khoá/hash lạ → null", async () => {
    const [a] = await api`select admin.tenant_id_by_key('acme') as id`;
    expect(a?.id).toBe(TENANT_ID.acme);
    const [none] = await api`select admin.tenant_id_by_key('khong-co') as id`;
    expect(none?.id).toBeNull();
    const [byHash] =
      await api`select admin.tenant_id_by_refresh_hash(${tokens.acme?.hash ?? sha256("x")}) as id`;
    expect(byHash?.id).toBe(TENANT_ID.acme);
    const [noHash] = await api`select admin.tenant_id_by_refresh_hash(${sha256("khong-co")}) as id`;
    expect(noHash?.id).toBeNull();
  });

  it("ADM-NFR-07 · spec §4 · hub_ro gọi hai hàm → 42501; PUBLIC không có EXECUTE", async () => {
    const code = (fn: string) =>
      scoped(env.owner, null, null, (tx) => sqlState(tx.unsafe(fn)), "hub_ro");
    expect(await code("select admin.tenant_id_by_key('acme')")).toBe("42501");
    expect(await code("select admin.tenant_id_by_refresh_hash('\\x00'::bytea)")).toBe("42501");
    const [p] = await env.owner`select
      has_function_privilege('public', 'admin.tenant_id_by_key(text)', 'EXECUTE') as k,
      has_function_privilege('public', 'admin.tenant_id_by_refresh_hash(bytea)', 'EXECUTE') as h`;
    expect([p?.k, p?.h]).toEqual([false, false]);
  });
});

describe("ADM-NFR-07 · quyền hub_ro", () => {
  const asHub = <T>(fn: (tx: Tx) => Promise<T>) => scoped(env.owner, null, null, fn, "hub_ro");

  it("ADM-NFR-07 · spec §4 · hub_ro: password_hash, select *, refresh_tokens → 42501", async () => {
    expect(await asHub((tx) => sqlState(tx`select password_hash from admin.users`))).toBe("42501");
    expect(await asHub((tx) => sqlState(tx`select * from admin.users`))).toBe("42501");
    expect(await asHub((tx) => sqlState(tx`select * from admin.refresh_tokens`))).toBe("42501");
  });

  it("ADM-NFR-07 · spec §4 · hub_ro đọc được cột an toàn của users (cả hai tenant), tenants, features", async () => {
    const r = await asHub(async (tx) => ({
      users: await tx`select id, tenant_id, username, role, active from admin.users`,
      tenants: await tx`select * from admin.tenants`,
      features: await tx`select * from admin.features`,
    }));
    expect(new Set(r.users.map((u) => u.tenant_id)).size).toBeGreaterThanOrEqual(2);
    expect(r.users).toHaveLength(14);
    expect(r.tenants).toHaveLength(4);
    expect(r.features.map((f) => f.key)).toEqual(["core"]);
  });

  it("ADM-NFR-07 · spec §4 · hub_ro insert/update bất kỳ bảng admin.* → 42501", async () => {
    const stmts = [
      "insert into admin.features (key, name) values ('x1', '{}')",
      "update admin.features set status = 'off'",
      "update admin.tenants set name = 'x'",
      "update admin.users set display_name = 'x'",
      "delete from admin.refresh_tokens",
      "insert into admin.tenants (key, name) values ('moi', 'Moi')",
    ];
    for (const s of stmts) expect(await asHub((tx) => sqlState(tx.unsafe(s)))).toBe("42501");
  });
});

describe("ADM-NFR-07 · thuộc tính role và bảng", () => {
  it("ADM-NFR-07 · spec §4 · admin_api: LOGIN, không super/bypassrls/createdb/createrole/replication, thuộc admin_rw, không sở hữu bảng", async () => {
    const [r] =
      await env.owner`select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
      rolreplication, pg_has_role('admin_api', 'admin_rw', 'member') as member
      from pg_roles where rolname = 'admin_api'`;
    expect(r).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      member: true,
    });
    const [owned] = await env.owner`select count(*)::int as n from pg_tables
      where schemaname = 'admin' and tableowner = 'admin_api'`;
    expect(owned?.n).toBe(0);
  });

  it("ADM-NFR-07 · spec §4 · RLS bật cho 13 bảng (8 bảng M1–M3 + audit_log/quota_alerts/tenant_quotas/user_totp/user_backup_codes của M4; không FORCE); 6 bảng còn lại không bật", async () => {
    const rows = await env.owner`select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'admin' and c.relkind = 'r' order by c.relname`;
    expect(rows.map((r) => [r.relname, r.relrowsecurity, r.relforcerowsecurity])).toEqual([
      ["audit_log", true, false],
      ["command_names", false, false],
      ["commands", false, false],
      ["config_meta", false, false],
      ["feature_commands", false, false],
      ["feature_entitlements", true, false],
      ["feature_grants", true, false],
      ["features", false, false],
      ["group_members", true, false],
      ["groups", true, false],
      ["quota_alerts", true, false],
      ["refresh_tokens", true, false],
      ["secrets", true, false],
      ["tenant_quotas", true, false],
      ["tenants", true, false],
      ["user_backup_codes", true, false],
      ["user_totp", true, false],
      ["users", true, false],
      ["workflows", false, false],
    ]);
  });
});

describe("ADM-BR-09 · AC-A09 · RLS với app thật", () => {
  it("ADM-BR-09 · AC-A09 · binh: dù owner chèn thêm user globex và gọi ?tenant_id=globex, mọi list/get chỉ ra user acme", async () => {
    const binh = await env.token("acme", "binh");
    await insertUsers(env.owner, [
      {
        id: "01900000-0000-7000-8000-000000000061",
        tenant_id: TENANT_ID.globex,
        username: "extra",
        email: null,
        password_hash: env.hashes.pw,
        display_name: "Extra",
        role: "member",
        locale: "vi",
        active: true,
        locked_by_tenant: false,
        must_change_password: false,
        last_login_at: null,
      },
    ]);
    for (const qs of ["", `?tenant_id=${TENANT_ID.globex}`]) {
      const res = await env.get(`/admin/users${qs}`, { token: binh });
      expect(res.status).toBe(200);
      expect(res.json.total).toBe(7);
      for (const u of res.json.items) expect(u.tenant_id).toBe(TENANT_ID.acme);
    }
    const got = await env.get("/admin/users/01900000-0000-7000-8000-000000000061", { token: binh });
    expect(got.status).toBe(404);
  });
});
