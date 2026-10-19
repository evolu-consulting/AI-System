// N5-FR-01…07 · N5-NFR-02 · công cụ chuyển user mgmt-app (spec N5 §2, §7 R1–R9). Test viết TRƯỚC code (làn đầy đủ):
// cách ly tenant, idempotent, dry-run không ghi, mật khẩu (nhập hash / buộc đặt lại — đăng nhập thật qua admin-api),
// không lộ hash (stdout/stderr CLI, audit), actor phải là platform admin. Dữ liệu export GIẢ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../apps/admin-api/src/app";
import { loadJwtKeys } from "../../../apps/admin-api/src/lib/jwt";
import { createDummyHash } from "../../../apps/admin-api/src/modules/auth/auth.service";
import {
  ImportAbort,
  runIdentityImport,
} from "../../../apps/admin-api/src/modules/identity-import/identity-import.run";
import {
  ADMIN_API_URL,
  argonOf,
  type CtxN5,
  KNOWN_PW,
  mkExport,
  ROLE_GROUP,
  rolesIn,
  SCRYPT_HASH,
  snapshot,
  startN5,
  tenantOfOrg,
  USERS,
  userX,
} from "./_support/n5";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "apps/admin-api/src/modules/identity-import/identity-import.cli.ts");
let c: CtxN5;
let argon: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  c = await startN5();
  argon = await argonOf(KNOWN_PW);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "n5",
  });
  app = createApp(
    { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
    { db: c.db, keys, appEnv: "test", dummyHash: await createDummyHash() },
  );
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const login = (tenant_key: string, username: string, password: string) =>
  app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key, username, password }),
  });
const run = (raw: unknown, apply: boolean, actorId = c.padmin, batch?: number) =>
  runIdentityImport(c.db, raw, { actorId, apply, batch });
const abortCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ImportAbort ? e.code : `other:${(e as Error).message}`;
  }
};

describe("N5-FR-06 · dry-run mặc định", () => {
  it("N5-FR-06 · không --apply ⇒ báo cáo số SẼ tạo, DB không đổi (không bump, không audit)", async () => {
    const before = await snapshot(c.sql);
    const raw = mkExport(
      [{ id: "dry-org", name: "Dry Co", tenant_key: "dry-co" }],
      [userX("a@dry.test", "dry-org", "owner"), userX("b@dry.test", "dry-org", "viewer")],
    );
    const r = await run(raw, false);
    expect(r.dry_run).toBe(true);
    expect(r.orgs).toEqual({ read: 1, created: 1, existing: 0, errors: 0 });
    expect(r.users.created).toBe(2);
    expect(await snapshot(c.sql)).toEqual(before);
  });
});

describe("N5-FR-02 · N5-FR-03 · N5-FR-07 · apply: tenant, Group vai, cách ly tenant", () => {
  const raw = () =>
    mkExport(
      [
        { id: "org-alpha", name: "Công ty Alpha" },
        { id: "org-bravo", name: "Bravo", tenant_key: "bravo-n5" },
        { id: "org-steal", name: "Steal", tenant_key: "acme" }, // key của tenant fixture (không mgmt_org_id)
      ],
      [
        userX("own@alpha.test", "org-alpha", "owner"),
        userX("ed@alpha.test", "org-alpha", "editor"),
        userX("vw@alpha.test", "org-alpha", "viewer"),
        userX("lan@example.test", "org-bravo", "editor"), // trùng email user acme ⇒ vẫn tạo riêng ở bravo
        userX("x@steal.test", "org-steal", "owner"),
      ],
    );

  it("N5-FR-02 · tạo tenant (settings.mgmt_org_id, slug bỏ dấu) + bật gói contracts (3 Group, 6 grant, 3 entitlement)", async () => {
    const r = await run(raw(), true);
    expect(r.dry_run).toBe(false);
    expect(r.orgs).toEqual({ read: 3, created: 2, existing: 0, errors: 1 });
    const [a] = await tenantOfOrg(c.sql, "org-alpha");
    expect(a?.key).toBe("cong-ty-alpha");
    const [b] = await tenantOfOrg(c.sql, "org-bravo");
    expect(b?.key).toBe("bravo-n5");
    const g = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.groups
      where tenant_id = ${a?.id as string} and key like 'contracts-%'`;
    expect(g[0]?.n).toBe(3);
    const gr = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.feature_grants fg
      join admin.features f on f.id = fg.feature_id where fg.tenant_id = ${a?.id as string} and f.key like 'contracts-%'`;
    expect(gr[0]?.n).toBe(6);
    const en = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id
      where e.tenant_id = ${a?.id as string} and f.key like 'contracts-%' and e.revoked_at is null`;
    expect(en[0]?.n).toBe(3);
  });

  it("N5-FR-07 · mỗi user chỉ vào Group vai của tenant org mình; owner ⇒ tenant_admin, còn lại member", async () => {
    const [a] = await tenantOfOrg(c.sql, "org-alpha");
    const [b] = await tenantOfOrg(c.sql, "org-bravo");
    expect(await rolesIn(c.sql, a?.id as string)).toEqual({
      "ed@alpha.test": [ROLE_GROUP.editor],
      "own@alpha.test": [ROLE_GROUP.owner],
      "vw@alpha.test": [ROLE_GROUP.viewer],
    });
    expect(await rolesIn(c.sql, b?.id as string)).toEqual({
      "lan@example.test": [ROLE_GROUP.editor],
    });
    const roles = await c.sql<
      { email: string; role: string; tid: string }[]
    >`select lower(email) as email, role,
      tenant_id as tid from admin.users where lower(email) like '%@alpha.test' order by 1`;
    expect(roles.map((x) => [x.email, x.role, x.tid === a?.id])).toEqual([
      ["ed@alpha.test", "member", true],
      ["own@alpha.test", "tenant_admin", true],
      ["vw@alpha.test", "member", true],
    ]);
    const plat = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.users
      where role = 'platform_admin' and tenant_id in (${a?.id as string}, ${b?.id as string})`;
    expect(plat[0]?.n).toBe(0);
  });

  it("N5-FR-07 · tenant fixture acme không bị đụng: key 'acme' ⇒ ORG_KEY_TAKEN, user ⇒ ORG_FAILED, user acme giữ nguyên", async () => {
    const acmeUsers = await c.sql`select id, username, password_hash, role from admin.users
      where tenant_id = ${USERS.lan.tid} order by id`;
    const acmeMembers =
      await c.sql`select * from admin.group_members where tenant_id = ${USERS.lan.tid}`;
    const r = await run(raw(), true);
    expect(r.issues).toContainEqual({ kind: "org", ref: "org-steal", code: "ORG_KEY_TAKEN" });
    expect(r.issues).toContainEqual({ kind: "user", ref: "x@steal.test", code: "ORG_FAILED" });
    expect([
      ...(await c.sql`select id, username, password_hash, role from admin.users where tenant_id = ${USERS.lan.tid} order by id`),
    ]).toEqual([...acmeUsers]);
    expect([
      ...(await c.sql`select * from admin.group_members where tenant_id = ${USERS.lan.tid}`),
    ]).toEqual([...acmeMembers]);
    const st = await c.sql`select settings from admin.tenants where id = ${USERS.lan.tid}`;
    expect(st[0]?.settings).toEqual({});
  });

  it("N5-FR-07 · idempotent: chạy lại ⇒ 0 tạo mới, không nhân đôi user/Group/thành viên/audit, không bump", async () => {
    await run(raw(), true);
    const before = await snapshot(c.sql);
    const r = await run(raw(), true);
    expect(r.orgs.created).toBe(0);
    expect(r.orgs.existing).toBe(2);
    expect(r.users.created).toBe(0);
    expect(r.users.existing).toBe(4);
    expect(await snapshot(c.sql)).toEqual(before);
  });

  it("N5-FR-07 · user đã có ở vai khác ⇒ ROLE_CONFLICT, không thêm Group (không nâng quyền ngầm)", async () => {
    const changed = mkExport(
      [{ id: "org-alpha", name: "Công ty Alpha" }],
      [userX("vw@alpha.test", "org-alpha", "owner")],
    );
    const r = await run(changed, true);
    expect(r.issues).toEqual([{ kind: "user", ref: "vw@alpha.test", code: "ROLE_CONFLICT" }]);
    const [a] = await tenantOfOrg(c.sql, "org-alpha");
    expect((await rolesIn(c.sql, a?.id as string))["vw@alpha.test"]).toEqual([ROLE_GROUP.viewer]);
  });
});

describe("N5-FR-03 · user tạo tay trùng email, khác username", () => {
  it("N5-FR-03 · đụng users_tenant_email_uq ⇒ USER_CONFLICT, không tạo, không thêm Group, lô vẫn xong", async () => {
    const [a] = await tenantOfOrg(c.sql, "org-alpha");
    await c.sql`insert into admin.users (tenant_id, username, email, password_hash, display_name, role)
      values (${a?.id as string}, 'tay-tao', 'Manual@Alpha.test', 'x', 'Tay', 'member')`;
    const r = await run(
      mkExport(
        [{ id: "org-alpha", name: "Công ty Alpha" }],
        [userX("manual@alpha.test", "org-alpha", "viewer"), userX("new2@alpha.test", "org-alpha")],
      ),
      true,
    );
    expect(r.issues).toEqual([{ kind: "user", ref: "manual@alpha.test", code: "USER_CONFLICT" }]);
    expect(r.users.created).toBe(1);
    expect((await rolesIn(c.sql, a?.id as string))["manual@alpha.test"]).toBeUndefined();
  });
});

describe("N5-FR-04 · mật khẩu", () => {
  const raw = () =>
    mkExport(
      [{ id: "org-pw", name: "Pw", tenant_key: "pw-n5" }],
      [
        userX("argon@pw.test", "org-pw", "editor", argon),
        userX("scrypt@pw.test", "org-pw", "editor", SCRYPT_HASH),
        userX("google@pw.test", "org-pw", "viewer", null),
      ],
    );
  it("N5-FR-04 · argon2id đủ mạnh ⇒ giữ hash, đăng nhập bằng mật khẩu cũ ⇒ 200, không buộc đổi", async () => {
    const r = await run(raw(), true);
    expect(r.users.hash_imported).toBe(1);
    expect(r.users.reset_required).toBe(2);
    const acc = r.accounts.find((x) => x.email === "argon@pw.test");
    expect(acc).toEqual({
      tenant_key: "pw-n5",
      email: "argon@pw.test",
      username: "argon",
      reset_required: false,
    });
    const res = await login("pw-n5", "argon", KNOWN_PW);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { access_token?: string }).access_token).toBeString();
  });
  it("N5-FR-04 · scrypt/không mật khẩu ⇒ buộc đặt lại: must_change_password, hash argon2id lạ, không đăng nhập được, audit reset_required", async () => {
    const rows = await c.sql<{ username: string; must: boolean; h: string }[]>`select username,
      must_change_password as must, password_hash as h from admin.users
      where lower(email) in ('scrypt@pw.test', 'google@pw.test') order by 1`;
    expect(rows.map((x) => [x.username, x.must])).toEqual([
      ["google", true],
      ["scrypt", true],
    ]);
    for (const x of rows) {
      expect(x.h.startsWith("$argon2id$")).toBe(true);
      expect(x.h).not.toBe(SCRYPT_HASH);
    }
    expect((await login("pw-n5", "scrypt", KNOWN_PW)).status).toBe(401);
    expect((await login("pw-n5", "google", "")).status).not.toBe(200);
    const au = await c.sql<
      { u: string; reset: string }[]
    >`select a.entity_name as u, a.summary->>'reset_required' as reset
      from admin.audit_log a where a.action = 'import' and a.entity = 'user'
        and a.tenant_id = (select id from admin.tenants where key = 'pw-n5') order by 1`;
    expect(au.map((x) => [x.u, x.reset])).toEqual([
      ["argon", "false"],
      ["google", "true"],
      ["scrypt", "true"],
    ]);
  });
});

describe("N5-NFR-02 · không lộ hash · N5-FR-05 mã thoát CLI", () => {
  it("N5-NFR-02 · CLI --apply: stdout/stderr không chứa hash; audit không chứa hash; exit 0 hoặc 2 theo lỗi hàng", async () => {
    const file = join(tmpdir(), `n5-${Bun.randomUUIDv7()}.json`);
    const raw = mkExport(
      [{ id: "org-cli", name: "Cli", tenant_key: "cli-n5" }],
      [
        userX("a@cli.test", "org-cli", "editor", argon),
        userX("b@cli.test", "org-cli", "viewer", SCRYPT_HASH),
        userX("bad-email", "org-cli", "viewer", argon),
      ],
    );
    await Bun.write(file, JSON.stringify(raw));
    const p = Bun.spawn(["bun", CLI, "--file", file, "--actor", c.padmin, "--apply"], {
      cwd: ROOT,
      env: { ...process.env, ADMIN_API_DATABASE_URL: ADMIN_API_URL },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    expect(code).toBe(2); // có lỗi hàng (INVALID_EMAIL)
    const all = out + err;
    for (const secret of [argon, SCRYPT_HASH, "$argon2id$", "scrypt:"])
      expect(all.includes(secret)).toBe(false);
    const rep = JSON.parse(out) as { users: { created: number }; issues: { code: string }[] };
    expect(rep.users.created).toBe(2);
    expect(rep.issues.map((i) => i.code)).toEqual(["INVALID_EMAIL"]);
    const leak = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.audit_log
      where coalesce(after::text, '') || coalesce(before::text, '') || summary::text like '%$argon2%'
         or coalesce(after::text, '') || summary::text like '%scrypt:%'
         or coalesce(after::text, '') || summary::text like '%password_hash%'`;
    expect(leak[0]?.n).toBe(0);
  });
  it("N5-FR-05 · CLI thiếu --actor / file hỏng ⇒ exit 1, không ghi gì", async () => {
    const before = await snapshot(c.sql);
    const file = join(tmpdir(), `n5-${Bun.randomUUIDv7()}.json`);
    await Bun.write(file, "{not json");
    const p = Bun.spawn(["bun", CLI, "--file", file, "--actor", c.padmin, "--apply"], {
      cwd: ROOT,
      env: { ...process.env, ADMIN_API_DATABASE_URL: ADMIN_API_URL },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await p.exited).toBe(1);
    expect(await snapshot(c.sql)).toEqual(before);
  });
});

describe("N5-FR-07 · actor và file", () => {
  it("N5-FR-07 · actor là tenant_admin / không tồn tại ⇒ ACTOR_INVALID, không ghi gì", async () => {
    const before = await snapshot(c.sql);
    const raw = mkExport([{ id: "o-x", name: "X" }], [userX("a@x.test", "o-x")]);
    expect(await abortCode(run(raw, true, USERS.tadmin.id))).toBe("ACTOR_INVALID");
    expect(await abortCode(run(raw, true, "a1000000-0000-4000-8000-0000000fffff"))).toBe(
      "ACTOR_INVALID",
    );
    expect(await snapshot(c.sql)).toEqual(before);
  });
  it("N5-FR-01 · sai format / thiếu mảng ⇒ BAD_FILE; hàng sai kiểu ⇒ BAD_ROW theo chỉ số (không chép giá trị)", async () => {
    expect(await abortCode(run({ format: "khac", orgs: [], users: [] }, false))).toBe("BAD_FILE");
    expect(await abortCode(run({ format: "mgmt-app-users/v1", orgs: [] }, false))).toBe("BAD_FILE");
    const r = await run(
      { format: "mgmt-app-users/v1", orgs: [{ id: "o-y", name: "Y" }], users: [{ email: 5 }] },
      false,
    );
    expect(r.issues).toEqual([{ kind: "user", ref: "users[0]", code: "BAD_ROW" }]);
  });
});
