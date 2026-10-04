// HUB-FR-23 · HUB-FR-89 · H2a-R14 · plan-db §4 (D3) · test-plan H2a cases §6 A93–A95: `hub:seed` cho H2a — provider
// `dify`, agent `dify-workflow`/`dify-agent` (`runtime_options.workflow_key`), `workflows.yaml` (`agent_workflows`,
// `workflow_flags.side_effect`). Luật: sai loại app / không map được input / `runtime_options` thừa khoá → lỗi seed (exit 1,
// không ghi gì); workflow không có trong `admin.workflows` → bỏ dòng + cảnh báo; `workflow_flags` upsert, idempotent.
// Seed dựng trong thư mục tạm (không phụ thuộc yaml mặc định của D3); catalog Admin = cases §7 (`insertCatalog`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
import { runHubSeed } from "../../../apps/hub-api/src/modules/seed/seed";
import {
  insertFixture,
  type Json,
  OWNER_URL,
  ownerSql,
  prepareDb,
  type Sql,
} from "../H1/_fixtures";
import { insertCatalog, WF } from "./_h2a";

const REPO = resolve(import.meta.dir, "../../..");
let sql: Sql;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertCatalog(sql, { baseUrl: "http://localhost:9/v1" });
  await sql`delete from hub.workflow_flags`;
  await sql`delete from hub.providers where key = 'dify'`;
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

const DESC = "Agent thử nghiệm của bộ kiểm thử seed H2a, không dùng thật.";
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
    name: { vi: Điều phối, en: Orchestrator }
    description: ${DESC}
    runtime: agentic-cli
    profile: fake-1
  - key: qc-tro-giup
    name: { vi: Trợ giúp, en: Helper }
    description: ${DESC}
    runtime: agentic-cli
    profile: fake-1
orchestrator:
  agent: orchestrator
`;
const DIFY_PROVIDER = `providers:
  - key: dify
    kind: api
    vendor: dify
    max_concurrency: 5
`;
const difyAgent = (key: string, runtime: string, options: string) => `  - key: ${key}
    name: { vi: ${key}, en: ${key} }
    description: ${DESC}
    runtime: ${runtime}
    profile: fake-1
    runtime_options: ${options}
`;

/** Thư mục seed tạm: `00-base.yaml` + các file thêm. */
function seedDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-h2a-seed-"));
  writeFileSync(join(dir, "00-base.yaml"), BASE);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

async function snapshot(): Promise<Json> {
  const [r] = await sql`select
    (select hub_config_version from hub.config_meta where id = 1) as version,
    (select coalesce(json_agg(key order by key), '[]') from hub.providers) as providers,
    (select coalesce(json_agg(key order by key), '[]') from hub.agents) as agents,
    (select count(*)::int from hub.agent_workflows) as agent_workflows,
    (select coalesce(json_agg(json_build_object('w', workflow_id, 's', side_effect) order by workflow_id), '[]')
       from hub.workflow_flags) as flags`;
  return r;
}

/** Chạy seed và bắt lỗi; trả chuỗi chi tiết (message + issues) hoặc null nếu không ném. */
async function seedError(dir: string): Promise<string | null> {
  try {
    await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
    return null;
  } catch (e) {
    return `${(e as Error).name} ${(e as Error).message} ${JSON.stringify((e as { issues?: unknown }).issues ?? "")}`;
  }
}

describe("A93 · agent dify-* sai cấu hình → lỗi seed, không ghi gì [H2a-R14]", () => {
  for (const [name, agent, field] of [
    [
      "dify-workflow trỏ workflow app chat (hoi)",
      difyAgent("qc-dify-sai-loai", "dify-workflow", "{ workflow_key: hoi }"),
      /qc-dify-sai-loai|app_type|hoi/,
    ],
    [
      "dify-workflow trỏ workflow không map được input chuỗi (so)",
      difyAgent("qc-dify-khong-input", "dify-workflow", "{ workflow_key: so }"),
      /qc-dify-khong-input|query|input/,
    ],
    [
      "runtime_options thừa khoá",
      difyAgent("qc-dify-thua", "dify-workflow", "{ workflow_key: tom, extra: 1 }"),
      /qc-dify-thua|extra|runtime_options/,
    ],
  ] as const) {
    it(`HUB-FR-23 · A93 · ${name} → runHubSeed ném lỗi nêu đúng chỗ sai, DB không đổi [H2a-R14]`, async () => {
      const dir = seedDir({ "10-h2a.yaml": `agents:\n${agent}` });
      try {
        const before = await snapshot();
        const detail = await seedError(dir);
        expect(detail).not.toBeNull();
        expect(detail ?? "").not.toMatch(/not implemented|ENOENT|ENOTDIR|EACCES/i);
        expect(detail ?? "").toMatch(field);
        expect(await snapshot()).toEqual(before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("HUB-FR-23 · A93 · CLI hub:seed với agent dify-* sai loại app → exit 1 [H2a-R14]", async () => {
    const dir = seedDir({
      "10-h2a.yaml": `agents:\n${difyAgent("qc-dify-cli", "dify-agent", "{ workflow_key: dich }")}`,
    });
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
      expect(out).toMatch(/qc-dify-cli|app_type|dich/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("A94–A95 · seed H2a hợp lệ [H2a-R14 · HUB-FR-23]", () => {
  const FILES = {
    "05-dify.yaml": DIFY_PROVIDER,
    "10-h2a.yaml": `agents:\n${difyAgent("qc-dify-tom", "dify-workflow", "{ workflow_key: tom }")}${difyAgent(
      "qc-dify-tro-ly",
      "dify-agent",
      "{ workflow_key: tro-ly }",
    )}${difyAgent("qc-dify-mat", "dify-workflow", "{ workflow_key: khong-co-wf }")}`,
    "20-workflows.yaml": `agent_workflows:
  - { agent: qc-tro-giup, workflow: create-trello-card }
  - { agent: qc-tro-giup, workflow: khong-co-wf2 }
workflow_flags:
  side_effect: [check-invoice, khong-co-wf3]
`,
  };

  it("HUB-FR-23 · A94 · workflow không có trong admin.workflows → bỏ dòng + cảnh báo (agent dify-*, agent_workflows, workflow_flags), phần còn lại vẫn ghi [H2a-R14]", async () => {
    const dir = seedDir(FILES);
    const lines: { level: string; line: string }[] = [];
    const restore = setSink((level, line) => lines.push({ level, line }));
    try {
      await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
      const warn = lines
        .filter((l) => l.level === "warn")
        .map((l) => l.line)
        .join("\n");
      for (const key of ["khong-co-wf", "khong-co-wf2", "khong-co-wf3"])
        expect(warn).toContain(key);
      const agents = await sql<
        { key: string }[]
      >`select key from hub.agents where key in ('qc-dify-tom', 'qc-dify-tro-ly', 'qc-dify-mat') order by key`;
      expect(agents.map((a) => a.key)).toEqual(["qc-dify-tom", "qc-dify-tro-ly"]);
      const [aw] = await sql<{ n: number }[]>`select count(*)::int as n from hub.agent_workflows aw
        where not exists (select 1 from admin.workflows w where w.id = aw.workflow_id)`;
      expect(aw?.n).toBe(0);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("HUB-FR-23 · A95 · provider dify (api, vendor dify, 5); agent_workflows + workflow_flags upsert; seed lần 2 không trùng [H2a-R14 · plan-db §4]", async () => {
    const dir = seedDir(FILES);
    try {
      await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
      const s1 = await snapshot();
      await runHubSeed({ url: OWNER_URL, dir, appEnv: "test" });
      const s2 = await snapshot();
      expect({ ...s2, version: 0 }).toEqual({ ...s1, version: 0 });
      const [p] = await sql<
        Json[]
      >`select kind, vendor, max_concurrency, enabled, dev_only from hub.providers
        where key = 'dify'`;
      expect(p).toEqual({
        kind: "api",
        vendor: "dify",
        max_concurrency: 5,
        enabled: true,
        dev_only: false,
      });
      const ag = await sql<Json[]>`select key, runtime, runtime_options from hub.agents
        where key in ('qc-dify-tom', 'qc-dify-tro-ly') order by key`;
      expect([...ag]).toEqual([
        { key: "qc-dify-tom", runtime: "dify-workflow", runtime_options: { workflow_key: "tom" } },
        {
          key: "qc-dify-tro-ly",
          runtime: "dify-agent",
          runtime_options: { workflow_key: "tro-ly" },
        },
      ]);
      const aw = await sql<Json[]>`select a.key, aw.workflow_id from hub.agent_workflows aw
        join hub.agents a on a.id = aw.agent_id where a.key = 'qc-tro-giup'`;
      expect([...aw]).toEqual([{ key: "qc-tro-giup", workflow_id: WF.trello }]);
      const flags = await sql<Json[]>`select workflow_id, side_effect from hub.workflow_flags`;
      expect([...flags]).toEqual([{ workflow_id: WF.checkInvoice, side_effect: true }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
