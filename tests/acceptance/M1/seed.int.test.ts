// ADM-NFR-06, ADM-NFR-01 · seed idempotent (test-plan B1; M1-AC01; M1-R20/R21).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createEnv, type Env, OWNER_URL, SEED_PW, TENANT_ID } from "./_fixtures";
import { loadSeed, ROOT } from "./_modules";

let env: Env;
beforeAll(async () => {
  env = await createEnv({ fixture: false });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.owner`truncate admin.refresh_tokens, admin.users, admin.tenants, admin.features cascade`;
});

const OPTS = { url: OWNER_URL, adminUsername: "admin", adminPassword: SEED_PW };
const seed = async (over: Partial<typeof OPTS> = {}) =>
  (await loadSeed()).runSeed({ ...OPTS, ...over });
const snapshot = async () => ({
  tenants: JSON.stringify(await env.owner`select * from admin.tenants order by key`),
  users: JSON.stringify(await env.owner`select * from admin.users order by username`),
  features: JSON.stringify(await env.owner`select * from admin.features order by key`),
});

describe("ADM-NFR-06 · M1-AC01 · seed hai lần", () => {
  it("ADM-NFR-06 · M1-AC01 · DB sạch: lần 1 → {created×3}, lần 2 → {exists×3}", async () => {
    expect(await seed()).toEqual({ tenant: "created", feature: "created", admin: "created" });
    expect(await seed()).toEqual({ tenant: "exists", feature: "exists", admin: "exists" });
  });

  it("ADM-NFR-06 · M1-R20 · hàng được tạo: tenant platform, feature core, user admin platform_admin, argon2id", async () => {
    await seed();
    const [t] = await env.owner`select * from admin.tenants`;
    expect([t?.key, t?.name, t?.max_concurrent_sub, t?.active]).toEqual([
      "platform",
      "Nền tảng",
      null,
      true,
    ]);
    const [f] = await env.owner`select * from admin.features`;
    expect([f?.key, f?.status]).toEqual(["core", "on"]);
    expect(f?.name).toEqual({ vi: "Cơ bản", en: "Core" });
    const users = await env.owner`select * from admin.users`;
    expect(users).toHaveLength(1);
    const u = users[0];
    expect(u?.username).toBe("admin");
    expect(u?.role).toBe("platform_admin");
    expect(u?.display_name).toBe("Platform Admin");
    expect(u?.email).toBeNull();
    expect(u?.locale).toBe("vi");
    expect(u?.must_change_password).toBe(false);
    expect(u?.active).toBe(true);
    expect(u?.tenant_id).toBe(t?.id);
    expect(u?.password_hash).toStartWith("$argon2id$v=19$m=19456,t=2,p=1$");
  });

  it("ADM-NFR-06 · M1-R20 · lần 2 không đổi password_hash/version/updated_at/số hàng, kể cả khi SEED_ADMIN_PASSWORD khác", async () => {
    await seed();
    const before = await snapshot();
    await seed();
    expect(await snapshot()).toEqual(before);
    await seed({ adminPassword: "Mot-Mat-Khau-Khac-99" });
    expect(await snapshot()).toEqual(before);
  });

  it("ADM-NFR-06 · M1-AC01 · đăng nhập platform/admin bằng mật khẩu seed → 200 role platform_admin", async () => {
    await seed();
    const res = await env.login("platform", "admin", SEED_PW);
    expect(res.status).toBe(200);
    expect(res.json.user.role).toBe("platform_admin");
  });
});

describe("ADM-NFR-06 · seed không ghi đè dữ liệu có sẵn", () => {
  it("ADM-NFR-06 · M1-R20 · tenant platform có sẵn (user khác, chưa có admin) → tenant exists, admin created", async () => {
    await env.owner`insert into admin.tenants (id, key, name) values (${TENANT_ID.acme}, 'platform', 'Nền tảng')`;
    await env.owner`insert into admin.users (tenant_id, username, password_hash, display_name, role)
      values (${TENANT_ID.acme}, 'ops', 'x', 'Ops', 'platform_admin')`;
    const r = await seed();
    expect(r.tenant).toBe("exists");
    expect(r.admin).toBe("created");
    const rows = await env.owner`select username from admin.users order by username`;
    expect(rows.map((x) => x.username)).toEqual(["admin", "ops"]);
  });

  it("ADM-NFR-06 · M1-R20 · đã có user admin nhưng khác role → không ghi đè", async () => {
    await env.owner`insert into admin.tenants (id, key, name) values (${TENANT_ID.acme}, 'platform', 'Nền tảng')`;
    await env.owner`insert into admin.users (tenant_id, username, password_hash, display_name, role)
      values (${TENANT_ID.acme}, 'admin', 'giu-nguyen', 'Admin Cu', 'member')`;
    const r = await seed();
    expect(r.admin).toBe("exists");
    const [u] = await env.owner`select role, password_hash, display_name from admin.users`;
    expect([u?.role, u?.password_hash, u?.display_name]).toEqual([
      "member",
      "giu-nguyen",
      "Admin Cu",
    ]);
  });

  it("ADM-NFR-06 · M1-R20 · tenant platform có sẵn với tên khác → không ghi đè tên, không có hàng nửa vời", async () => {
    await env.owner`insert into admin.tenants (id, key, name) values (${TENANT_ID.acme}, 'platform', 'Ten Khac')`;
    const r = await seed();
    expect(r.tenant).toBe("exists");
    const [t] = await env.owner`select count(*)::int as n, min(name) as name from admin.tenants`;
    expect([t?.n, t?.name]).toEqual([1, "Ten Khac"]);
  });
});

describe("ADM-NFR-06 · loadSeedEnv", () => {
  const good = {
    DATABASE_URL: "postgres://u:p@localhost:5432/x_test",
    APP_ENV: "test",
    SEED_ADMIN_USERNAME: "admin",
    SEED_ADMIN_PASSWORD: "Seed-Admin-Pw-01",
  };
  const load = async (src: Record<string, string | undefined>) =>
    (await loadSeed()).loadSeedEnv(src);

  it("ADM-NFR-06 · M1-R20 · env hợp lệ → trả về giá trị đã parse", async () => {
    const e = await load(good);
    expect(e.SEED_ADMIN_USERNAME).toBe("admin");
    expect(e.SEED_ADMIN_PASSWORD).toBe("Seed-Admin-Pw-01");
  });

  it("ADM-NFR-06 · M1-R20 · thiếu biến → lỗi nêu đúng tên biến, không chứa giá trị", async () => {
    for (const name of ["SEED_ADMIN_USERNAME", "SEED_ADMIN_PASSWORD", "DATABASE_URL"]) {
      const src: Record<string, string | undefined> = { ...good, [name]: undefined };
      let msg = "";
      try {
        await load(src);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain(name);
      if (name !== "SEED_ADMIN_PASSWORD") expect(msg).not.toContain(good.SEED_ADMIN_PASSWORD);
      if (name !== "DATABASE_URL") expect(msg).not.toContain("u:p@");
    }
  });

  it("ADM-NFR-06 · M1-R20 · mật khẩu 9 ký tự, username 'Admin!' hoặc 1 ký tự → lỗi nêu tên biến, không chứa giá trị sai", async () => {
    const cases: Array<[string, string]> = [
      ["SEED_ADMIN_PASSWORD", "short-pw1"],
      ["SEED_ADMIN_USERNAME", "Admin!"],
      ["SEED_ADMIN_USERNAME", "a"],
    ];
    for (const [name, value] of cases) {
      let msg = "";
      try {
        await load({ ...good, [name]: value });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain(name);
      expect(msg).not.toContain(value);
    }
  });

  it("ADM-NFR-06 · M1-R20 · APP_ENV=production + mật khẩu rỗng → lỗi", async () => {
    let failed = false;
    try {
      await load({ ...good, APP_ENV: "production", SEED_ADMIN_PASSWORD: "" });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe("ADM-NFR-06 · CLI db:seed", () => {
  const run = (over: Record<string, string | undefined>) => {
    const env2: Record<string, string> = {};
    const merged: Record<string, string | undefined> = {
      ...process.env,
      DATABASE_URL: OWNER_URL,
      APP_ENV: "test",
      SEED_ADMIN_USERNAME: "admin",
      SEED_ADMIN_PASSWORD: SEED_PW,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined) env2[k] = v;
    const p = Bun.spawnSync(["bun", "packages/db/src/seed.ts"], { cwd: ROOT, env: env2 });
    return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
  };

  it("ADM-NFR-06 · M1-R20 · lần 1 in 'created' ×3, lần 2 'exists' ×3, exit 0", () => {
    const a = run({});
    expect(a.code).toBe(0);
    expect(a.out).toContain("db:seed OK: tenant created, feature created, admin created");
    const b = run({});
    expect(b.code).toBe(0);
    expect(b.out).toContain("db:seed OK: tenant exists, feature exists, admin exists");
  });

  it("ADM-NFR-06 · M1-R20 · thiếu SEED_ADMIN_USERNAME → exit 1, nêu tên biến, không lộ mật khẩu", () => {
    const secret = "Cli-Secret-Pw-123";
    const r = run({ SEED_ADMIN_USERNAME: undefined, SEED_ADMIN_PASSWORD: secret });
    expect(r.code).toBe(1);
    expect(r.out).toContain("SEED_ADMIN_USERNAME");
    expect(r.out).not.toContain(secret);
  });
});
