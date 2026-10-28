// com-c12a/c12b · seed cộng đồng đối tác: --apply hai lần (không trùng, mật khẩu chỉ ở file), dry-run chỉ in kế hoạch;
// bật gói community, nhãn partner_companies, bài + luồng mẫu (che liên hệ, audience D2) cũng idempotent.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { assertTenant, runSeed, type SeedOpts } from "./seed-community-demo";
import { PARTNER_SEEDS, POST_SAMPLES } from "./seed-community-demo.data";

let sql: Sql;
let admin: Db;
let hub: Db;
let dir: string;
let tenantKey = "";
let tenantId = "";
beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [tenantId] = (await tenants(sql, 1, 61)) as [string];
  await users(sql, tenantId, 1, { from: 61, role: "tenant_admin" });
  const [t] = await sql<
    { key: string }[]
  >`select key from admin.tenants where id = ${tenantId}::uuid`;
  tenantKey = (t as { key: string }).key;
  admin = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 3 });
  hub = createDb(urls().hubApi, { max: 3 });
  dir = mkdtempSync(join(tmpdir(), "seed-community-"));
});
afterAll(async () => {
  await hub.close();
  await admin.close();
  await sql.end();
  rmSync(dir, { recursive: true, force: true });
});

const opts = (o: Partial<SeedOpts> = {}): SeedOpts => ({
  tenantKey,
  forceTenant: true,
  apply: true,
  out: join(dir, "pw.json"),
  hubDb: hub,
  log: () => {},
  ...o,
});
const count = async (q: string) => {
  const [r] = await sql.unsafe(q);
  return (r as unknown as { n: number }).n;
};

describe("com-c12 · seed-community-demo", () => {
  it("từ chối tenant khác demo nếu không có --force-tenant", () => {
    expect(() => assertTenant("nitigroup", false)).toThrow();
    expect(() => assertTenant("demo", false)).not.toThrow();
  });

  it("dry-run: chỉ in kế hoạch, không ghi DB/file", async () => {
    const lines: string[] = [];
    await runSeed(admin, opts({ apply: false, log: (s) => lines.push(s) }));
    expect(lines.join("\n")).toContain("Cơ sở Tân Phát");
    expect(lines.join("\n")).toContain("Thùng phi 200L");
    expect(await count("select count(*)::int n from admin.external_orgs")).toBe(0);
    expect(existsSync(join(dir, "pw.json"))).toBe(false);
  });

  it("--apply hai lần: công ty/user/nhãn/bài/bình luận không trùng, liên hệ bị che, mật khẩu chỉ ở file", async () => {
    const n = PARTNER_SEEDS.length;
    const np = POST_SAMPLES.length;
    const a = await runSeed(admin, opts());
    expect(a.orgs).toEqual({ created: n, existing: 0 });
    expect(a.users).toEqual({ created: n, existing: 0 });
    expect(a.posts.created).toBe(np);
    expect(a.posts.comments).toBe(POST_SAMPLES.flatMap((p) => p.replies ?? []).length);
    const b = await runSeed(admin, opts());
    expect(b.orgs).toEqual({ created: 0, existing: n });
    expect(b.users).toEqual({ created: 0, existing: n });
    expect(b.posts).toEqual({ created: 0, existing: np, comments: 0 });

    expect(await count("select count(*)::int n from admin.external_orgs")).toBe(n);
    expect(await count("select count(*)::int n from community.posts")).toBe(np);
    expect(await count("select count(*)::int n from community.partner_companies")).toBe(n);
    expect(
      await count(
        `select count(*)::int n from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
         where f.key like 'community-%' and e.tenant_id = '${tenantId}' and e.revoked_at is null`,
      ),
    ).toBe(3);
    // Nội dung đối tác: liên hệ bị che ở cột masked, raw vẫn còn cho người đăng.
    expect(
      await count(
        `select count(*)::int n from community.comments
         where author_org is not null and text_raw like '%0903%' and text_masked not like '%0903%'`,
      ),
    ).toBe(2);
    expect(
      await count(
        `select count(*)::int n from community.posts
         where title_raw = 'Băng keo 5cm' and author_org is not null and body_masked not like '%0903%'
           and body_masked not like '%zalo.me%'`,
      ),
    ).toBe(2); // bài Tân Phát (số + link bị che) và bài Hưng Thịnh (không có liên hệ)

    const pw = JSON.parse(readFileSync(join(dir, "pw.json"), "utf8")) as {
      users: Record<string, string>;
    };
    expect(Object.keys(pw.users).sort()).toEqual(PARTNER_SEEDS.map((p) => p.username).sort());
    const map = JSON.parse(readFileSync(`${join(dir, "pw.json")}.community.json`, "utf8"));
    const tp = map.partners.find((p: { org_name: string }) => p.org_name === "Cơ sở Tân Phát");
    expect(tp.party_key).toBe("tax:0101000003");
  });

  it("--grant-owner/--grant-editor: thêm user nội bộ (idempotent, audit actor hệ thống), từ chối user ngoài", async () => {
    const [u] = await sql<{ username: string }[]>`select username from admin.users
      where tenant_id = ${tenantId}::uuid and kind = 'internal' order by created_at limit 1`;
    const name = (u as { username: string }).username;
    const members = (g: string) =>
      count(`select count(*)::int n from admin.group_members m join admin.groups g on g.id = m.group_id
        join admin.users u on u.id = m.user_id
        where g.tenant_id = '${tenantId}' and g.key = '${g}' and u.username = '${name}'`);
    const a = await runSeed(admin, opts({ grantOwner: [name], grantEditor: [name] }));
    expect(a.granted).toEqual({ owner: [name], editor: [name] });
    const b = await runSeed(admin, opts({ grantOwner: [name] }));
    expect(b.granted.owner).toEqual([]);
    expect(await members("community-owner")).toBe(1);
    expect(await members("community-editor")).toBe(1);
    expect(
      await count(
        `select count(*)::int n from admin.group_members where tenant_id = '${tenantId}' and added_by is not null
          and user_id = (select id from admin.users where tenant_id = '${tenantId}' and username = '${name}')`,
      ),
    ).toBe(0); // actor hệ thống
    const ext = (PARTNER_SEEDS[0] as (typeof PARTNER_SEEDS)[0]).username;
    await expect(runSeed(admin, opts({ grantOwner: [ext] }))).rejects.toThrow(/ngoài/);
    expect(await members("community-owner")).toBe(1);
  });
});
