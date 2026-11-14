// CR-159 · CLI onboarding `users:` + add-on trên DB thật (role admin_api, RLS bật; mẫu "full" có gói `pkdemo`): tạo mới (đúng usecase
// users.service), chạy lại không đổi gì và không sinh mật khẩu, trưởng/thành viên gán đúng (không pending), thiếu nơi ghi mật khẩu
// ⇒ lỗi trước khi ghi DB, mật khẩu không có trong báo cáo, đổi tên/chức vụ/vai không đụng mật khẩu.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { parseSpec } from "./adapters/onboard.schema";
import { onboardTenant } from "./tenant-onboard.run";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const PT = "01900000-0000-7000-8000-000000c15901";
const PA = "01900000-0000-7000-8000-000000c15902";
let owner: postgres.Sql;
let db: ReturnType<typeof createDb>;
let pwFile = "";

const yaml = (o: { name?: string; title?: string; role?: string; key?: string } = {}) => `
key: ${o.key ?? "cr159-t"}
name: Cong ty CR159
packs: [pkdemo]
addons: [contracts-community]
users:
  - { email: boss@cr159.test, name: ${o.name ?? "Sếp Tổng"}, title: "${o.title ?? "Giám đốc"}", role: admin }
  - { email: head.kd@cr159.test, name: Trưởng KD, title: Trưởng phòng kinh doanh, role: ${o.role ?? "member"} }
  - { email: staff@cr159.test, name: Nhân viên, title: Nhân viên kinh doanh, role: member }
root: { key: pb-gd, vi: Ban Giám đốc, head: boss@cr159.test }
departments:
  - { key: pb-kd, vi: Phòng Kinh doanh, head: head.kd@cr159.test, members: [staff@cr159.test] }
`;
const spec = (o?: Parameters<typeof yaml>[0]) => {
  const p = parseSpec(yaml(o));
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.spec;
};
const sink = async (email: string, pw: string) => {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(pwFile, `${email}\t${pw}\n`, { mode: 0o600 });
};
const lines = async () =>
  (await readFile(pwFile, "utf8").catch(() => "")).split("\n").filter((l) => l !== "");
const snap = async (key = "cr159-t") =>
  (
    await owner<{ cv: number; audit: number; users: string; hashes: string }[]>`select
      (select config_version from admin.config_meta where id = 1)::int as cv,
      (select count(*) from admin.audit_log)::int as audit,
      (select string_agg(u.username || ':' || u.version, ',' order by u.username) from admin.users u
        join admin.tenants t on t.id = u.tenant_id where t.key = ${key}) as users,
      (select string_agg(u.password_hash, ',' order by u.username) from admin.users u
        join admin.tenants t on t.id = u.tenant_id where t.key = ${key}) as hashes`
  )[0];

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER as string, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  db = createDb(API as string, { max: 6 });
  pwFile = join(await mkdtemp(join(tmpdir(), "cr159-")), "pw.tsv");
  await owner`insert into admin.tenants (id, key, name) values (${PT}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind)
    values (${PA}, ${PT}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test', 'internal')`;
  await owner`insert into admin.features (key, name, status)
    values ('contracts-community', '{"vi":"Bảng tin","en":"Community feed"}', 'on') on conflict (key) do nothing`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

describe("CR-159 · onboarding users + add-on", () => {
  test("tạo mới: user qua users.service (must_change_password), chức vụ, vai, add-on, trưởng và thành viên gán ngay (không pending), mật khẩu chỉ trong file", async () => {
    const r = await onboardTenant(db, spec(), PA, sink);
    expect(r.users).toEqual({
      created: 3,
      updated: 0,
      unchanged: 0,
      created_emails: ["boss@cr159.test", "head.kd@cr159.test", "staff@cr159.test"],
    });
    expect(r.members.pending_emails).toEqual([]);
    expect(r.members.heads_set).toBe(2);
    expect(r.members.added).toBe(3);
    expect(r.addons).toEqual([{ key: "contracts-community", granted: true }]);

    const us = await owner<
      { username: string; role: string; must: boolean; title: string | null; locked: boolean }[]
    >`select u.username, u.role, u.must_change_password as must, pp.job_title as title, u.locked_by_tenant as locked
      from admin.users u join admin.tenants t on t.id = u.tenant_id and t.key = 'cr159-t'
      left join hub.people_profiles pp on pp.user_id = u.id order by u.username`;
    expect(us.map((u) => [u.username, u.role, u.must, u.title])).toEqual([
      ["boss", "tenant_admin", true, "Giám đốc"],
      ["head.kd", "member", true, "Trưởng phòng kinh doanh"],
      ["staff", "member", true, "Nhân viên kinh doanh"],
    ]);
    const heads = await owner<{ key: string; email: string }[]>`select g.key, u.email
      from admin.departments d join admin.groups g on g.id = d.group_id
      join admin.users u on u.id = d.head_user_id order by g.key`;
    expect(heads.map((h) => [h.key, h.email])).toEqual([
      ["pb-gd", "boss@cr159.test"],
      ["pb-kd", "head.kd@cr159.test"],
    ]);
    const ent =
      await owner`select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      join admin.tenants t on t.id = e.tenant_id where f.key = 'contracts-community' and t.key = 'cr159-t' and e.revoked_at is null`;
    expect(ent).toHaveLength(1);

    const ls = await lines();
    expect(ls).toHaveLength(3);
    for (const l of ls) {
      const [email, pw] = l.split("\t");
      expect(email).toContain("@cr159.test");
      expect((pw ?? "").length).toBeGreaterThanOrEqual(14);
      expect(JSON.stringify(r)).not.toContain(pw as string);
    }
    if (process.platform !== "win32") expect((await stat(pwFile)).mode & 0o777).toBe(0o600);
  });

  test("chạy lại lần 2: không đổi gì (version, audit, config_version, mật khẩu), không sinh mật khẩu mới", async () => {
    const before = await snap();
    const r = await onboardTenant(db, spec(), PA, sink);
    expect(r.users).toEqual({ created: 0, updated: 0, unchanged: 3, created_emails: [] });
    expect(r.addons).toEqual([{ key: "contracts-community", granted: false }]);
    expect(r.members).toEqual({ added: 0, heads_set: 0, pending_emails: [] });
    expect(await snap()).toEqual(before);
    expect(await lines()).toHaveLength(3);
  });

  test("đổi tên và chức vụ (boss) và vai (head.kd lên quản trị) ⇒ chỉ cập nhật các trường đó, giữ mật khẩu, không thêm dòng mật khẩu", async () => {
    const before = await snap();
    const r = await onboardTenant(
      db,
      spec({ name: "Sếp Mới", title: "Tổng giám đốc", role: "admin" }),
      PA,
      sink,
    );
    expect(r.users).toMatchObject({ created: 0, updated: 2, unchanged: 1 });
    const [u] = await owner<
      { n: string; role: string; t: string }[]
    >`select u.display_name as n, u.role, pp.job_title as t
      from admin.users u join hub.people_profiles pp on pp.user_id = u.id where u.username = 'boss'`;
    expect(u).toEqual({ n: "Sếp Mới", role: "tenant_admin", t: "Tổng giám đốc" });
    const [k] = await owner<
      { role: string }[]
    >`select role from admin.users where username = 'head.kd'`;
    expect(k?.role).toBe("tenant_admin");
    expect((await snap())?.hashes).toBe(before?.hashes);
    expect(await lines()).toHaveLength(3);
  });

  test("có user mới mà không có nơi ghi mật khẩu ⇒ lỗi PW_OUT_REQUIRED, không ghi gì vào DB", async () => {
    const before = await snap("cr159-x");
    const nTenants = async () =>
      (await owner<{ n: number }[]>`select count(*)::int as n from admin.tenants`)[0]?.n;
    const tenants = await nTenants();
    const err = await onboardTenant(db, spec({ key: "cr159-x" }), PA).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAppError(err) && err.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify((err as { details?: unknown }).details)).toContain("PW_OUT_REQUIRED");
    expect(await nTenants()).toBe(tenants);
    expect(await owner`select 1 from admin.tenants where key = 'cr159-x'`).toHaveLength(0);
    expect((await snap("cr159-x"))?.audit).toBe(before?.audit);
    expect(await lines()).toHaveLength(3);
  });

  test("add-on chưa đăng ký ⇒ lỗi rõ, không im lặng", async () => {
    const s = { ...spec({ key: "cr159-y" }), addons: ["khong-co-addon"] };
    const err = await onboardTenant(db, s, PA, sink).then(
      () => null,
      (e: unknown) => e,
    );
    expect(JSON.stringify((err as { details?: unknown }).details)).toContain("ADDON_UNKNOWN");
  });
});
