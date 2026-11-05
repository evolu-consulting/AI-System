// pm-ready · fixture CR-113 (mở rộng seed.tenant-fixtures): Group Pháp chế + quy trình duyệt HĐ mẫu (2 bước review, bước 1 có due_h
// và KHÔNG đặt nhóm chuyển cấp) đã xuất bản + gán cho evolu; chủ gói (Toàn quyền) không thuộc Group của bước nào; chạy 2 lần ⇒ y nguyên.
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
import { validateSlotBody } from "../packs/contracts/domain/approval-slot.rules";
import { runHubSeed } from "./seed";
import { CR113_DEF, CR113_SLOT_BODY, LEGAL_GROUP } from "./seed.cr113-flow";
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
  const defs =
    await sql`select id, key, slot, published_version from hub.process_defs where id = ${CR113_DEF.id}`;
  const rels =
    await sql`select rel_version from hub.process_def_releases where def_id = ${CR113_DEF.id}`;
  const asg =
    await sql`select slot, def_id from hub.process_routing_rules where is_default order by tenant_id, slot`;
  return JSON.stringify([defs, rels, asg, await members(LEGAL_GROUP.key)]);
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await setup();
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

describe("pm-ready · fixture CR-113 (quy trình duyệt mẫu cho evolu)", () => {
  it("mẫu hợp lệ theo luật khe: 2 bước review, bước 1 có due_h không đặt nhóm chuyển cấp, bước 2 đặt tường minh", () => {
    expect(validateSlotBody(CR113_SLOT_BODY)).toEqual([]);
    const [s1, s2] = CR113_SLOT_BODY.steps;
    expect(s1?.kind).toBe("review");
    expect(s1?.due_h).toBeGreaterThan(0);
    expect(s1?.escalate_group_key).toBeNull();
    expect(s2?.due_h).toBeGreaterThan(0);
    expect(s2?.escalate_group_key).toBe("contracts-editor");
  });

  it("seed ghi Group Pháp chế, def thư viện đã xuất bản, gán cho evolu; chạy 2 lần y nguyên", async () => {
    await seed();
    const first = await snapshot();
    await seed();
    expect(await snapshot()).toBe(first);

    expect(await members(LEGAL_GROUP.key)).toEqual(["edgar.nguyen", "rowan.nguyen"]);
    expect(await members(ACCOUNTING.key)).toEqual(["thomas.tran", "vio.ngo"]);
    // chủ gói (Toàn quyền) tách khỏi người duyệt của cả hai bước
    expect(await members("contracts-owner")).toEqual(["julian.bui"]);

    const [def] =
      await sql`select slot, published_version, enabled, tenant_id, slot_body from hub.process_defs where id = ${CR113_DEF.id}`;
    expect(def).toMatchObject({
      slot: "contracts.approval",
      published_version: 1,
      enabled: true,
      tenant_id: null,
    });
    const [rel] =
      await sql`select count(*)::int as n from hub.process_def_releases where def_id = ${CR113_DEF.id}`;
    expect(rel?.n).toBe(1);
    const asg = await sql`select a.def_id::text as def_id, t.key from hub.process_routing_rules a
      join admin.tenants t on t.id = a.tenant_id where a.is_default and a.slot = 'contracts.approval'`;
    expect(asg.map((r) => ({ def_id: r.def_id, key: r.key }))).toEqual([
      { def_id: CR113_DEF.id, key: "evolu" },
    ]);
  });
});
