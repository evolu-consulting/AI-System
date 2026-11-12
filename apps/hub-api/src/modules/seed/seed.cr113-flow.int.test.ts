// pm-ready · fixture CR-113 (mở rộng seed.tenant-fixtures): Group Pháp chế cho evolu (CR-127 Z3d: không còn seed quy trình/gán).
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
import { LEGAL_GROUP } from "./seed.cr113-flow";
import { ACCOUNTING } from "./seed.tenant-fixtures";

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
    description: Agent thử của test seed cr113-flow.
    runtime: agentic-cli
    profile: fake-1
orchestrator:
  agent: orchestrator
`;

async function seed(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "seed-cr113-"));
  try {
    writeFileSync(join(dir, "00-base.yaml"), BASE);
    await runHubSeed({ url: OWNER_URL, dir, appEnv: "development", fixtures: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const USERS = [
  ["julian.bui", "tenant_admin"],
  ["thomas.tran", "member"],
  ["vio.ngo", "member"],
  ["edgar.nguyen", "member"],
  ["rowan.nguyen", "member"],
] as const;

async function setup(): Promise<void> {
  const id = crypto.randomUUID();
  await sql`insert into admin.tenants (id, key, name, active) values (${id}, 'evolu', 'evolu', true)`;
  for (const g of ["contracts-owner", "contracts-editor"])
    await sql`insert into admin.groups (tenant_id, key, name) values (${id}, ${g}, ${sql.json({ vi: g })})`;
  const rows = USERS.map(([username, role]) => ({
    id: crypto.randomUUID(),
    tenant_id: id,
    username,
    email: `${username}@evolu.local`,
    password_hash: "x",
    display_name: username,
    role,
    locale: "en",
    must_change_password: false,
  }));
  await sql`insert into admin.users ${sql(rows)}`;
}

const members = async (group: string): Promise<string[]> =>
  (
    await sql`select u.username from admin.group_members m
      join admin.groups g on g.id = m.group_id join admin.tenants t on t.id = g.tenant_id
      join admin.users u on u.id = m.user_id where t.key = 'evolu' and g.key = ${group} order by 1`
  ).map((r) => String(r.username));

async function snapshot(): Promise<string> {
  const groups = await sql`select key from admin.groups where key = ${LEGAL_GROUP.key}`;
  return JSON.stringify([groups, await members(LEGAL_GROUP.key)]);
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await setup();
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

describe("pm-ready · fixture CR-113 (Group Pháp chế cho evolu)", () => {
  it("seed ghi Group Pháp chế + thành viên, KHÔNG ghi quy trình/gán khe duyệt; chạy 2 lần y nguyên", async () => {
    await seed();
    const first = await snapshot();
    await seed();
    expect(await snapshot()).toBe(first);

    expect(await members(LEGAL_GROUP.key)).toEqual(["edgar.nguyen", "rowan.nguyen"]);
    expect(await members(ACCOUNTING.key)).toEqual(["thomas.tran", "vio.ngo"]);
    // chủ gói (Toàn quyền) tách khỏi người duyệt
    expect(await members("contracts-owner")).toEqual(["julian.bui"]);

    const [defs] =
      await sql`select count(*)::int as n from hub.process_defs where key = 'hd-cr113-mau'`;
    expect(defs?.n).toBe(0);
  });
});
