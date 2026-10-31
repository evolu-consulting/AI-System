// CR-105 · pl-seed-sample · "QT thử" chỉ dev/test: chạy 2 lần ⇒ 1 def + 1 release v1, không gán tenant, không làm mặc định khe;
// production hoặc không bật fixtures ⇒ không tạo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insertFixture,
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Sql,
} from "../../../../../tests/acceptance/H1/_fixtures";
import { runHubSeed } from "./seed";
import { LIBRARY_SAMPLE } from "./seed.library-sample";

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
    description: Agent thử của test seed library-sample.
    runtime: agentic-cli
    profile: fake-1
orchestrator:
  agent: orchestrator
`;

async function seed(appEnv: string, fixtures: boolean): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "seed-libsample-"));
  try {
    writeFileSync(join(dir, "00-base.yaml"), BASE);
    await runHubSeed({ url: OWNER_URL, dir, appEnv, fixtures });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const count = async (q: PromiseLike<readonly unknown[]>) => (await q).length;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await sql`delete from hub.process_def_releases where def_id = ${LIBRARY_SAMPLE.id}`;
  await sql`delete from hub.process_defs where id = ${LIBRARY_SAMPLE.id}`;
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

describe("CR-105 · seed QT thử", () => {
  it("production hoặc không bật fixtures ⇒ không tạo", async () => {
    await seed("production", true);
    await seed("development", false);
    expect(await count(sql`select 1 from hub.process_defs where key = ${LIBRARY_SAMPLE.key}`)).toBe(
      0,
    );
  });

  it("dev + fixtures, chạy 2 lần ⇒ 1 def + 1 release v1 đã xuất bản, bước Kế toán duyệt theo mã, không gán", async () => {
    await seed("development", true);
    await seed("test", true);
    const defs = await sql`select slot, tenant_id, published_version, slot_body, stages
      from hub.process_defs where key = ${LIBRARY_SAMPLE.key}`;
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      slot: "contracts.approval",
      tenant_id: null,
      published_version: 1,
    });
    const steps = (
      (defs[0] as { slot_body: unknown }).slot_body as { steps: Record<string, unknown>[] }
    ).steps;
    expect(steps.map((s) => s.key)).toEqual(["level1", "level2", "accounting"]);
    expect(steps[2]).toMatchObject({
      department_group_key: "pb-ke-toan",
      department_group_id: null,
    });
    expect(
      await count(sql`select 1 from hub.process_def_releases where def_id = ${LIBRARY_SAMPLE.id}`),
    ).toBe(1);
    expect(
      await count(sql`select 1 from hub.process_slots where default_def_id = ${LIBRARY_SAMPLE.id}`),
    ).toBe(0);
    expect(
      await count(
        sql`select 1 from hub.process_slot_assignments where def_id = ${LIBRARY_SAMPLE.id}`,
      ),
    ).toBe(0);
  });
});
