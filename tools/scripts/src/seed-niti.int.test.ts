// tool-seed-niti · int (DB thật): chạy thử KHÔNG ghi gì; --apply tạo đủ (tenant, gói, phòng ban, user, vai, quy trình xuất bản + gán,
// luật chọn quy trình theo phòng ban × loại HĐ); chạy lại = không đổi; mật khẩu chỉ ở file, không ở log; tenant lệch hình ⇒ từ chối.
// Dùng SeedSpec giả (KHÔNG dữ liệu khách thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { runSeed } from "./seed-niti";
import type { SeedSpec } from "./seed-niti.data";

const D = (k: string, vi: string) => ({ key: k, vi, en: vi });
const SPEC: SeedSpec = {
  tenantKey: "seedtest",
  tenantName: "Seed Test Co",
  timezone: "Asia/Ho_Chi_Minh",
  emailDomain: "seedtest.example.invalid",
  packs: ["contracts", "community"],
  root: D("pb-root", "Ban Root"),
  departments: [D("pb-sales", "Sales"), D("pb-acc", "Accounting")],
  people: [
    {
      username: "boss",
      display: "Boss",
      title: "x",
      dept: "pb-root",
      head: true,
      role: "tenant_admin",
      packRole: "owner",
    },
    {
      username: "sal1",
      display: "Sal 1",
      title: "x",
      dept: "pb-sales",
      head: true,
      role: "member",
      packRole: "editor",
    },
    {
      username: "acc1",
      display: "Acc 1",
      title: "x",
      dept: "pb-acc",
      head: true,
      role: "member",
      packRole: "editor",
    },
    {
      username: "sal2",
      display: "Sal 2",
      title: "x",
      dept: "pb-sales",
      head: false,
      role: "member",
      packRole: "editor",
    },
  ],
};

let o: Sql;
let admin: Db;
let hub: Db;
let dir: string;
let cred: string;
const logs: string[] = [];
const opts = (apply: boolean) => ({ apply, credFile: cred, log: (s: string) => void logs.push(s) });

/** Ảnh chụp số hàng các bảng seed chạm tới (so trước/sau). */
async function snap(): Promise<string> {
  const [r] = await o`select
    (select count(*) from admin.tenants) t, (select count(*) from admin.users) u, (select count(*) from admin.groups) g,
    (select count(*) from admin.group_members) gm, (select count(*) from hub.process_defs) d,
    (select count(*) from hub.process_def_releases) rel, (select count(*) from hub.process_tenant_defs) a,
    (select count(*) from hub.process_routing_rules) rr, (select count(*) from hub.audit_log) ha,
    (select config_version from admin.config_meta) cv, (select hub_config_version from hub.config_meta where id = 1) hv`;
  return JSON.stringify(r);
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  admin = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 2 });
  hub = connectDb(urls().hubApi, 4);
  const [p] = await o`select 1 from admin.users where role = 'platform_admin'`;
  if (!p) {
    const id = "00000000-0000-4000-8000-0000000071f0";
    await o`insert into admin.tenants (id, key, name) values (${id}, 'platform-st', 'Platform ST') on conflict do nothing`;
    await o`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role)
      values (${id}, ${id}, 'padmin', 'padmin@kit.test', 'x', 'PA', 'platform_admin') on conflict do nothing`;
  }
  dir = mkdtempSync(join(tmpdir(), "seed-niti-"));
  cred = join(dir, "cred.txt");
}, 180_000);
afterAll(async () => {
  await admin?.close();
  await hub?.close();
  await o?.end();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("seed-niti", () => {
  it("chạy thử không ghi gì (kể cả file mật khẩu)", async () => {
    const before = await snap();
    const r = await runSeed(admin, hub, SPEC, opts(false));
    expect(await snap()).toBe(before);
    expect(r.tenant).toBe("created");
    expect(r.usersCreated).toHaveLength(4);
    expect(() => readFileSync(cred)).toThrow();
  });

  it("--apply tạo đủ và mật khẩu chỉ ở file, không ở log", async () => {
    logs.length = 0;
    await runSeed(admin, hub, SPEC, opts(true));
    const t = (await o`select id from admin.tenants where key = 'seedtest'`)[0]?.id as string;
    expect(
      (
        await o`select role, must_change_password from admin.users where tenant_id = ${t} order by username`
      ).map((u) => `${u.role}/${u.must_change_password}`),
    ).toEqual(["member/true", "tenant_admin/true", "member/true", "member/true"]);
    const dep =
      await o`select g.key from admin.groups g where tenant_id = ${t} and key like 'pb-%' order by key`;
    expect(dep.map((g) => g.key)).toEqual(["pb-acc", "pb-root", "pb-sales"]);
    const own =
      await o`select u.username from admin.group_members m join admin.groups g on g.id = m.group_id
      join admin.users u on u.id = m.user_id where m.tenant_id = ${t} and g.key in ('contracts-owner','community-owner') order by 1`;
    expect([...new Set(own.map((x) => x.username))]).toEqual(["boss"]);
    // CR-127 Z3: không tạo def / gán / luật định tuyến nào từ seed.
    expect(
      (
        await o`select count(*)::int n from hub.process_defs where key in ('st-buy','st-sell') and tenant_id is null`
      )[0]?.n,
    ).toBe(0);
    expect(
      (await o`select count(*)::int n from hub.process_tenant_defs where tenant_id = ${t}`)[0]?.n,
    ).toBe(0);
    expect(
      (await o`select count(*)::int n from hub.process_routing_rules where tenant_id = ${t}`)[0]?.n,
    ).toBe(0);
    // CR-121 D-4 · gán quy trình là đủ: seed KHÔNG cấp feature `contracts-approval-engine` (hay feature nào khác cho engine).
    expect(
      (
        await o`select count(*)::int n from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
          where e.tenant_id = ${t} and f.key = 'contracts-approval-engine'`
      )[0]?.n,
    ).toBe(0);
    const text = readFileSync(cred, "utf8");
    const pws = text
      .trim()
      .split("\n")
      .map((l) => l.split("\t")[2] as string);
    expect(pws).toHaveLength(4);
    for (const pw of pws) expect(logs.join("\n")).not.toContain(pw);
  });

  it("chạy lại = không đổi gì", async () => {
    const before = await snap();
    const file = readFileSync(cred, "utf8");
    const r = await runSeed(admin, hub, SPEC, opts(true));
    expect(r.usersCreated).toEqual([]);
    expect(r.credFile).toBeNull();
    expect(await snap()).toBe(before);
    expect(readFileSync(cred, "utf8")).toBe(file);
  });

  it("tenant trùng tên nhưng khác khoá ⇒ từ chối, không ghi", async () => {
    const before = await snap();
    await expect(
      runSeed(admin, hub, { ...SPEC, tenantKey: "other-key" }, opts(true)),
    ).rejects.toThrow(/khác hình dạng/);
    expect(await snap()).toBe(before);
  });
});
