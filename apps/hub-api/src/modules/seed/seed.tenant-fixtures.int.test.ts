// seed-refresh · fixture công ty evolu/demo của `hub:seed`: chỉ dev/test + HUB_SEED_FIXTURES; production ⇒ không đụng DB;
// chạy 2 lần ⇒ cùng kết quả (idempotent). Bảo đảm: owner ∈ Group owner gói, (không cấp feature engine), Kế toán 2 thành viên,
// locale vi, thương hiệu host, URL catalog (chỉ appEnv=development).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Sql,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { runHubSeed } from "./seed";
import { ACCOUNTING, DEV_APP_URLS } from "./seed.tenant-fixtures";

let sql: Sql;
const BASE = `providers:
  - key: fake-cli
    kind: subscription
    vendor: fake
    max_concurrency: 2
model_profiles:
  - key: fake-1
    steps:
      - provider_key: fake-cli
agents:
  - key: orchestrator
    name: { vi: orchestrator, en: orchestrator }
    description: Agent thử của test seed tenant-fixtures.
    runtime: agentic-cli
    profile: fake-1
orchestrator:
  agent: orchestrator
`;

async function seed(appEnv: string, fixtures: boolean): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "seed-tfx-"));
  try {
    writeFileSync(join(dir, "00-base.yaml"), BASE);
    await runHubSeed({ url: OWNER_URL, dir, appEnv, fixtures });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ROLE_GROUPS = ["contracts-owner", "community-owner", "contracts-editor", "community-editor"];
const U = [
  ["evolu", "julian.bui", "tenant_admin"],
  ["evolu", "thomas.tran", "member"],
  ["evolu", "vio.ngo", "member"],
  ["evolu", "edgar.nguyen", "member"],
  ["demo", "demo-owner", "tenant_admin"],
  ["demo", "demo-viewer", "member"],
  ["demo", "demo-editor", "member"],
] as const;

async function setup(): Promise<void> {
  const ids = new Map<string, string>();
  for (const key of ["evolu", "demo"]) {
    const id = crypto.randomUUID();
    ids.set(key, id);
    await sql`insert into admin.tenants (id, key, name, active) values (${id}, ${key}, ${key}, true)`;
    for (const g of [...ROLE_GROUPS])
      await sql`insert into admin.groups (tenant_id, key, name) values (${id}, ${g}, ${sql.json({ vi: g })})`;
  }
  const rows = U.map(([t, username, role]) => ({
    id: crypto.randomUUID(),
    tenant_id: ids.get(t) as string,
    username,
    email: `${username}@${t === "demo" ? "example.invalid" : "evolu.local"}`, // như deploy/tenants/demo.yaml
    password_hash: "x",
    display_name: username,
    role,
    locale: "en",
    must_change_password: false,
  }));
  await sql`insert into admin.users ${sql(rows)}`;
}

const members = async (tenant: string, group: string): Promise<string[]> =>
  (
    await sql`select u.username from admin.group_members m
      join admin.groups g on g.id = m.group_id join admin.tenants t on t.id = g.tenant_id
      join admin.users u on u.id = m.user_id where t.key = ${tenant} and g.key = ${group} order by 1`
  ).map((r) => String(r.username));
const entitled = async (): Promise<string[]> =>
  (
    await sql`select t.key from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      join admin.tenants t on t.id = e.tenant_id where f.key = 'contracts-approval-engine' and e.revoked_at is null order by 1`
  ).map((r) => String(r.key));
const emptyUrls = async (): Promise<number> =>
  (await sql`select 1 from admin.app_catalog where url = ''`).length;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await setup();
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

describe("seed-refresh · fixture công ty evolu/demo", () => {
  it("production hoặc không bật fixtures ⇒ không đụng gì (không Group Kế toán, feature, brand, URL, locale)", async () => {
    const before = await emptyUrls();
    expect(before).toBeGreaterThan(0);
    await seed("production", true);
    await seed("development", false);
    expect(await members("evolu", ACCOUNTING.key)).toEqual([]);
    expect(await entitled()).toEqual([]);
    expect(await members("evolu", "contracts-owner")).toEqual([]);
    expect(await emptyUrls()).toBe(before);
    expect((await sql`select 1 from admin.users where locale = 'vi'`).length).toBe(0);
    expect(
      (
        await sql`select 1 from contracts.company_settings cs join admin.tenants t on t.id = cs.tenant_id where t.key in ('evolu','demo')`
      ).length,
    ).toBe(0);
  });

  it("appEnv=test + fixtures ⇒ seed công ty nhưng KHÔNG điền URL catalog (chỉ development)", async () => {
    const before = await emptyUrls();
    await seed("test", true);
    expect(await entitled()).toEqual([]); // CR-121 D-4 · không cấp feature engine
    expect(await emptyUrls()).toBe(before);
  });

  it("development + fixtures (chạy 2 lần): owner ∈ Group owner, editor evolu, engine, Kế toán 2 người, locale vi, brand, URL", async () => {
    await seed("development", true);
    await seed("development", true);
    for (const g of ["contracts-owner", "community-owner"]) {
      expect(await members("evolu", g)).toEqual(["julian.bui"]);
      expect(await members("demo", g)).toEqual(["demo-owner"]);
    }
    for (const g of ["contracts-editor", "community-editor"]) {
      expect(await members("evolu", g)).toEqual(["edgar.nguyen", "thomas.tran", "vio.ngo"]);
      expect(await members("demo", g)).toEqual([]); // demo giữ vai theo demo.yaml
    }
    expect(await entitled()).toEqual([]); // CR-121 D-4 · gán quy trình là đủ, không cấp feature engine
    expect(await members("evolu", ACCOUNTING.key)).toEqual(["thomas.tran", "vio.ngo"]);
    expect(await members("demo", ACCOUNTING.key)).toEqual(["demo-editor", "demo-viewer"]);
    const grp =
      await sql`select g.name from admin.groups g join admin.tenants t on t.id = g.tenant_id
      where t.key = 'evolu' and g.key = ${ACCOUNTING.key}`;
    expect(grp[0]?.name).toEqual({ vi: "Phòng Kế toán", en: "Accounting" });
    expect((await sql`select 1 from admin.users where locale <> 'vi'`).length).toBe(0);
    const brand = await sql`select t.key, cs.company_name, cs.app_name, cs.accent, cs.logo
      from contracts.company_settings cs join admin.tenants t on t.id = cs.tenant_id order by 1`;
    expect(brand.map((b) => b.key)).toEqual(["demo", "evolu"]);
    expect(brand.find((b) => b.key === "evolu")).toMatchObject({
      company_name: "Evolu",
      logo: null,
    });
    expect(await emptyUrls()).toBe(0);
    const urls =
      await sql`select key, url from admin.app_catalog where key = any(${Object.keys(DEV_APP_URLS)})`;
    for (const r of urls) expect(r.url).toBe(DEV_APP_URLS[String(r.key)]);
    expect(urls.length).toBeGreaterThan(0);
  });

  it("không seed han-muc-duyet (chỉ cấp tay trên prod)", async () => {
    expect(
      (
        await sql`select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
          where f.key = 'han-muc-duyet'`
      ).length,
    ).toBe(0);
  });
});
