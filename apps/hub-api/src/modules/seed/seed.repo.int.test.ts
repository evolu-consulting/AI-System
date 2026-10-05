// HUB-FR-62 · H2b-R13 · REVIEW 1 — Hub #1: seed `orchestrator_tenants` lặp lại với cùng yaml KHÔNG tiêu sequence `smallint`
// `hub.orchestrator_settings_id_seq` (trước đây `insert … on conflict` tính DEFAULT `nextval` mỗi lần → cạn sau ~32k lần).
// Hàng có rồi → UPDATE chỉ khi khác (version/updated_at giữ nguyên nếu không đổi); hàng mới → INSERT lấy `nextval`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insertFixture,
  type Json,
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Sql,
  T,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { runHubSeed } from "./seed";

let sql: Sql;

const agent = (key: string) => `  - key: ${key}
    name: { vi: ${key}, en: ${key} }
    description: Agent thử của test seed.repo, không dùng thật.
    runtime: agentic-cli
    profile: fake-1
`;
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
${agent("orchestrator")}${agent("orch-acme")}orchestrator:
  agent: orchestrator
`;
const tenants = (...lines: string[]) =>
  `orchestrator_tenants:\n${lines.map((l) => `  - ${l}\n`).join("")}`;

async function seed(extra?: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "seed-repo-int-"));
  try {
    writeFileSync(join(dir, "00-base.yaml"), BASE);
    if (extra) writeFileSync(join(dir, "10-t.yaml"), extra);
    await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function seqState(): Promise<{ last: number; called: boolean }> {
  const [r] =
    await sql`select last_value::int as last, is_called as called from hub.orchestrator_settings_id_seq`;
  return { last: Number(r?.last), called: Boolean(r?.called) };
}
async function tenantRows(): Promise<Json[]> {
  return [
    ...(await sql`select s.id, s.tenant_id, a.key as agent, s.max_steps, s.version, s.updated_at
      from hub.orchestrator_settings s join hub.agents a on a.id = s.agent_id
      where s.tenant_id is not null order by s.id`),
  ];
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await seed();
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

describe("REVIEW 1 — Hub #1 · seed orchestrator_tenants không tiêu sequence khi không thêm hàng", () => {
  const ACME = tenants("{ tenant_key: acme, agent: orch-acme, max_steps: 3 }");

  it("seed cùng yaml 6 lần → 1 hàng, version/updated_at/id giữ nguyên, last_value sequence không tăng", async () => {
    await seed(ACME);
    const first = await tenantRows();
    const seq0 = await seqState();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      tenant_id: T.acme,
      agent: "orch-acme",
      max_steps: 3,
      version: 1,
    });
    for (let i = 0; i < 5; i++) await seed(ACME);
    expect(await tenantRows()).toEqual(first);
    expect(await seqState()).toEqual(seq0);
  });

  it("đổi giá trị → UPDATE (version +1, cùng id), sequence không tăng", async () => {
    const [before] = await tenantRows();
    const seq0 = await seqState();
    await seed(tenants("{ tenant_key: acme, agent: orchestrator, max_steps: 4 }"));
    const [after] = await tenantRows();
    expect(after).toMatchObject({
      id: before?.id,
      agent: "orchestrator",
      max_steps: 4,
      version: 2,
    });
    expect(await seqState()).toEqual(seq0);
  });

  it("remove rồi thêm lại → INSERT mới lấy đúng một nextval", async () => {
    const seq0 = await seqState();
    await seed(tenants("{ tenant_key: acme, remove: true }"));
    expect(await tenantRows()).toHaveLength(0);
    await seed(ACME);
    const rows = await tenantRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seq0.last + 1);
    expect(await seqState()).toEqual({ last: seq0.last + 1, called: true });
  });
});
