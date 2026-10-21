// tenant-owner · tenant-owner-setup trên DB thật (role admin_api, scope platform): dry-run không ghi; --apply tạo tenant_admin KHÔNG
// email (DB 0020), mật khẩu trong file 600 đăng nhập được qua use case login thật (bước bắt đổi mật khẩu); Group contracts-owner +
// trưởng "Phòng Giám đốc"; notifier không bị gọi; chạy lại = "exists", không ghi file.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { enablePack, tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { loadJwtKeys } from "../../../apps/admin-api/src/lib/jwt";
import { createDummyHash, login } from "../../../apps/admin-api/src/modules/auth/auth.service";
import { runOwnerSetup } from "../../../tools/scripts/src/tenant-owner-setup";
import { parseOwnerArgs } from "../../../tools/scripts/src/tenant-owner-setup.rules";

let sql: Sql;
let db: Db;
let A = "";
let dir = "";
beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A] = (await tenants(sql, 1, 2711)) as [string];
  await sql`update admin.tenants set key = 'nitigroup' where id = ${A}`;
  await sql`insert into admin.tenants (key, name) values ('platform', 'Platform') on conflict (key) do nothing`;
  await sql`insert into admin.users (tenant_id, username, password_hash, display_name, role)
    select id, 'root-to', 'x', 'Root', 'platform_admin' from admin.tenants where key = 'platform'`;
  await enablePack(sql, [A], "contracts");
  await sql`insert into admin.groups (tenant_id, key, name) values
    (${A}, 'phong-kd', '{"vi":"Phòng Kinh doanh"}'), (${A}, 'phong-gd', '{"vi":"Phòng Giám đốc"}')`;
  await sql`insert into admin.departments (tenant_id, group_id)
    select tenant_id, id from admin.groups where tenant_id = ${A} and key in ('phong-kd', 'phong-gd')`;
  db = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 2 });
  dir = mkdtempSync(join(tmpdir(), "tenant-owner-"));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 1 });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const argv = (out: string, apply: boolean) => [
  ...["--tenant", "nitigroup", "--name", "Lê Thị Thuý Tiên", "--username", "tien", "--out", out],
  ...(apply ? ["--apply"] : []),
];

async function signIn(password: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = await loadJwtKeys({
    JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
    JWT_KID: "to",
  });
  const ctx = { db, keys, now: () => new Date(), dummyHash: await createDummyHash() };
  return login(
    ctx,
    { tenant_key: "nitigroup", username: "tien", password },
    { client: "web", userAgent: "t" },
  );
}

describe("tenant-owner-setup", () => {
  it("dry-run không ghi; --apply tạo chủ không email, đăng nhập được, Group + trưởng phòng; chạy lại no-op; không thông báo", async () => {
    const notifier = { send: mock(async () => {}) };
    const out = join(dir, "TENANT_OWNER_nitigroup.txt");
    const dry = await runOwnerSetup({ db, notifier }, parseOwnerArgs(argv(out, false)));
    expect(dry.created).toBe(false);
    expect(dry.plan).toMatchObject({
      kind: "create",
      group: { key: "contracts-owner" },
      dept: { key: "phong-gd" },
    });
    expect(existsSync(out)).toBe(false);

    const r = await runOwnerSetup({ db, notifier }, parseOwnerArgs(argv(out, true)));
    expect(r.created).toBe(true);
    const [u] = await sql`select id, email, role, locale, display_name, must_change_password as must
      from admin.users where tenant_id = ${A} and username = 'tien'`;
    expect(u).toMatchObject({
      email: null,
      role: "tenant_admin",
      locale: "vi",
      display_name: "Lê Thị Thuý Tiên",
      must: true,
    });
    const pw = /password: (\S+)/.exec(readFileSync(out, "utf8"))?.[1] ?? "";
    expect(pw).toMatch(/^[A-Za-z0-9]{24}$/);
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);
    expect((await signIn(pw)).kind).toBe("change");

    const [g] = await sql`select
      exists (select 1 from admin.group_members m join admin.groups g on g.id = m.group_id
        where m.user_id = ${u?.id} and g.key = 'contracts-owner') as member,
      (select g.key from admin.departments d join admin.groups g on g.id = d.group_id
        where d.head_user_id = ${u?.id}) as head`;
    expect(g).toEqual({ member: true, head: "phong-gd" });

    const out2 = join(dir, "again.txt");
    const again = await runOwnerSetup({ db, notifier }, parseOwnerArgs(argv(out2, true)));
    expect(again).toEqual({ plan: { kind: "exists" }, created: false });
    expect(existsSync(out2)).toBe(false);
    const [n] =
      await sql`select count(*)::int as n from admin.users where tenant_id = ${A} and username = 'tien'`;
    expect(n?.n).toBe(1);
    expect(notifier.send).not.toHaveBeenCalled();
  });
});
