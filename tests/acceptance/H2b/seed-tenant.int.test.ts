// HUB-FR-62 · HUB-H2b-AC-10 · H2b-R13 · plan §5.3 · plan-db §4 · plan-errors §3 · test-plan H2b §5, cases §2 A70–A76:
// `hub:seed` mục `orchestrator_tenants` — upsert theo `tenant_key` (trường thiếu = bản mặc định cùng yaml, `id ≥ 2`,
// hàng `id=1` giữ nguyên), seed lại không trùng, `remove: true` xoá, bản không nhắc giữ nguyên; tenant lạ → bỏ + cảnh báo;
// agent lạ/tắt/runtime ≠ agentic-cli, `tenant_key` trùng → lỗi seed (CLI exit 1), không ghi dở. Seed dựng trong thư mục tạm.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runHubSeed } from "../../../apps/hub-api/src/modules/seed/seed";
import {
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  T,
  USERS,
} from "../H1/_fixtures";
import type { HubX } from "../H1/_hub";
import { insertCatalog } from "../H2a/_h2a";
import { captureLogs, menuKeys, startHubH2b } from "./_h2b";

const REPO = resolve(import.meta.dir, "../../..");
let sql: Sql;
let k: Keys;
let hub: HubX;

const DESC = "Agent thử nghiệm của bộ kiểm thử seed H2b, không dùng thật.";
const agent = (key: string, extra = "") => `  - key: ${key}
    name: { vi: ${key}, en: ${key} }
    description: ${DESC}
    runtime: agentic-cli
    profile: fake-1
${extra}`;
const BASE = `providers:
  - key: fake-cli
    kind: subscription
    vendor: fake
    max_concurrency: 2
  - key: dify
    kind: api
    vendor: dify
    max_concurrency: 5
model_profiles:
  - key: fake-1
    steps:
      - provider_key: fake-cli
agents:
${agent("orchestrator")}${agent("orch-acme")}${agent("orch-alt")}${agent("qc-tro-giup")}${agent("qc-tat", "    enabled: false\n")}  - key: qc-dify-tl
    name: { vi: Dify, en: Dify }
    description: ${DESC}
    runtime: dify-agent
    profile: fake-1
    runtime_options: { workflow_key: tro-ly }
orchestrator:
  agent: orchestrator
  max_steps: 4
  token_budget: 150000
  history_n: 7
  on_no_match: ask
entitlements:
  - { agent: qc-tro-giup, tenant_key: acme }
grants:
  - { agent: qc-tro-giup, tenant_key: acme, subject: "user:lan" }
`;
const tenants = (...lines: string[]) =>
  `orchestrator_tenants:\n${lines.map((l) => `  - ${l}\n`).join("")}`;

/** Thư mục seed tạm: `00-base.yaml` + file thêm. */
function seedDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-h2b-seed-"));
  writeFileSync(join(dir, "00-base.yaml"), BASE);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
async function seed(files: Record<string, string> = {}): Promise<{ version: number }> {
  const dir = seedDir(files);
  try {
    return await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Lỗi seed (message + issues) hoặc null nếu không ném. */
async function seedError(files: Record<string, string>): Promise<string | null> {
  try {
    await seed(files);
    return null;
  } catch (e) {
    return `${(e as Error).name} ${(e as Error).message} ${JSON.stringify((e as { issues?: unknown }).issues ?? "")}`;
  }
}
async function settings(): Promise<Json[]> {
  return [
    ...(await sql`select s.id, s.tenant_id, a.key as agent, s.max_steps, s.token_budget, s.history_n,
        s.on_no_match, s.version, s.updated_at
      from hub.orchestrator_settings s join hub.agents a on a.id = s.agent_id order by s.id`),
  ];
}
async function snapshot(): Promise<Json> {
  const [v] = await sql`select hub_config_version as v from hub.config_meta where id = 1`;
  return { version: v?.v, settings: await settings() };
}
const tenantRow = async (tenantId: string) =>
  (await settings()).find((r) => r.tenant_id === tenantId);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertCatalog(sql, { baseUrl: "http://localhost:9/v1" });
  await seed();
  k = await makeKeys();
  hub = await startHubH2b(k);
}, 60_000);
afterEach(async () => {
  await sql`delete from hub.orchestrator_settings where tenant_id is not null`;
});
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

describe("A70–A72, A74–A76 · seed orchestrator_tenants hợp lệ [HUB-H2b-AC-10 · H2b-R13]", () => {
  it("HUB-FR-62 · A70 · {acme, orch-acme, max_steps:3} → 1 hàng tenant_id=acme, id ≥ 2, trường thiếu = bản mặc định cùng yaml; hàng id=1 không đổi; hub_config_version +1 [HUB-H2b-AC-10 · H2b-R13]", async () => {
    const before = await snapshot();
    const r = await seed({
      "10-t.yaml": tenants("{ tenant_key: acme, agent: orch-acme, max_steps: 3 }"),
    });
    expect(r.version).toBe(before.version + 1);
    const after = await settings();
    expect(after[0]).toEqual(before.settings[0]);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({
      tenant_id: T.acme,
      agent: "orch-acme",
      max_steps: 3,
      token_budget: 150_000,
      history_n: 7,
      on_no_match: "ask",
    });
    expect(after[1]?.id).toBeGreaterThanOrEqual(2);
  });

  it("HUB-FR-62 · A71 · seed lại y hệt → không hàng trùng, hàng tenant giữ version/updated_at; đổi max_steps → version hàng +1 [H2b-R13 · plan-db §4]", async () => {
    const files = { "10-t.yaml": tenants("{ tenant_key: acme, agent: orch-acme, max_steps: 3 }") };
    await seed(files);
    const first = await tenantRow(T.acme);
    expect(first).toBeDefined();
    await seed(files);
    const rows = await settings();
    expect(rows.filter((x) => x.tenant_id !== null)).toHaveLength(1);
    expect(await tenantRow(T.acme)).toEqual(first);
    await seed({ "10-t.yaml": tenants("{ tenant_key: acme, agent: orch-acme, max_steps: 4 }") });
    expect(await tenantRow(T.acme)).toMatchObject({
      max_steps: 4,
      version: (first?.version ?? 0) + 1,
    });
  });

  it("HUB-FR-62 · A72 · tenant_key zzz → bỏ + warn seed-orchestrator-tenant-unknown {tenant_key: zzz}; mục acme vẫn ghi [HUB-H2b-AC-10 · H1 Q8]", async () => {
    const log = captureLogs();
    try {
      await seed({
        "10-t.yaml": tenants(
          "{ tenant_key: zzz, agent: orch-acme }",
          "{ tenant_key: acme, agent: orch-alt }",
        ),
      });
    } finally {
      log.restore();
    }
    const warn = log.lines
      .filter((l) => l.level === "warn")
      .map((l) => JSON.stringify(l.rec))
      .find((s) => s.includes("seed-orchestrator-tenant-unknown"));
    expect(warn).toBeDefined();
    expect(warn).toContain("zzz");
    expect((await settings()).filter((x) => x.tenant_id !== null)).toHaveLength(1);
    expect(await tenantRow(T.acme)).toMatchObject({ agent: "orch-alt" });
  });

  it("HUB-FR-62 · A74 · {acme, remove:true} → xoá bản acme; bản beta không nhắc → giữ [H2b-R13]", async () => {
    await seed({
      "10-t.yaml": tenants(
        "{ tenant_key: acme, agent: orch-acme }",
        "{ tenant_key: beta, agent: orch-alt }",
      ),
    });
    const beta = await tenantRow(T.beta);
    expect(beta).toBeDefined();
    await seed({ "10-t.yaml": tenants("{ tenant_key: acme, remove: true }") });
    expect(await tenantRow(T.acme)).toBeUndefined();
    expect(await tenantRow(T.beta)).toEqual(beta);
  });

  it("HUB-FR-62 · A75 · yaml không có orchestrator_tenants → hàng tenant giữ nguyên [H2b-R13 · H1-R16]", async () => {
    await sql`insert into hub.orchestrator_settings (tenant_id, agent_id, max_steps)
      select ${T.acme}, id, 3 from hub.agents where key = 'orch-acme'`;
    const before = await tenantRow(T.acme);
    expect(before).toBeDefined();
    await seed();
    expect(await tenantRow(T.acme)).toEqual(before);
  });

  it("HUB-FR-62 · A76 · seed bản beta = agent đang là Orchestrator mặc định → hợp lệ; menu lan không đổi [H2b-R13 · H2b-R15]", async () => {
    const token = await sign(k, USERS.lan);
    expect(await menuKeys(hub, token)).toEqual(["qc-tro-giup"]);
    await seed({ "10-t.yaml": tenants("{ tenant_key: beta, agent: orchestrator }") });
    expect(await tenantRow(T.beta)).toMatchObject({ agent: "orchestrator" });
    expect(await menuKeys(hub, token)).toEqual(["qc-tro-giup"]);
  });
});

describe("A73 · seed orchestrator_tenants sai → lỗi seed, không ghi dở [HUB-H2b-AC-10 · H2b-R13]", () => {
  for (const [name, lines, field] of [
    ["agent không tồn tại", ["{ tenant_key: acme, agent: qc-khong-co }"], /qc-khong-co/],
    ["agent enabled=false", ["{ tenant_key: acme, agent: qc-tat }"], /qc-tat/],
    ["agent runtime dify-agent", ["{ tenant_key: acme, agent: qc-dify-tl }"], /qc-dify-tl/],
    [
      "tenant_key trùng (1 upsert + 1 remove)",
      ["{ tenant_key: acme, agent: orch-acme }", "{ tenant_key: acme, remove: true }"],
      /acme/,
    ],
  ] as const) {
    it(`HUB-FR-62 · A73 · ${name} → runHubSeed ném lỗi nêu orchestrator_tenants + giá trị sai; DB (version, orchestrator_settings) không đổi [HUB-H2b-AC-10 · H2b-R13]`, async () => {
      const before = await snapshot();
      const detail = await seedError({
        "10-t.yaml": tenants(...lines, "{ tenant_key: beta, agent: orch-alt }"),
      });
      expect(detail).not.toBeNull();
      expect(detail ?? "").not.toMatch(/unrecognized|not implemented|ENOENT/i);
      expect(detail ?? "").toMatch(/orchestrator_tenants/);
      expect(detail ?? "").toMatch(field);
      expect(await snapshot()).toEqual(before);
    });
  }

  it("HUB-FR-62 · A73 · CLI hub:seed với agent lạ trong orchestrator_tenants → exit 1, log nêu agent [HUB-H2b-AC-10]", async () => {
    const dir = seedDir({ "10-t.yaml": tenants("{ tenant_key: acme, agent: qc-cli-khong-co }") });
    try {
      const proc = Bun.spawn(["bun", "apps/hub-api/src/modules/seed/seed.ts"], {
        cwd: REPO,
        env: { ...process.env, DATABASE_URL: OWNER_URL, APP_ENV: "test", HUB_SEED_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
      expect(code).toBe(1);
      expect(out).not.toMatch(/unrecognized/i);
      expect(out).toMatch(/qc-cli-khong-co/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
